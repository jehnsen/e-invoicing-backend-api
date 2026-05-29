# EIS Ready — Project Overview

Philippine BIR Electronic Invoicing System (EIS) compliance SaaS middleware. Provides a multi-tenant REST API that receives invoices from ERP systems, validates and signs them per BIR Revenue Regulations 11-2025, transmits them to the BIR EIS API, and archives them for the mandatory 10-year retention period.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Core Invariants](#4-core-invariants)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Surface](#6-api-surface)
7. [Data Model](#7-data-model)
8. [Invoice Processing Pipeline](#8-invoice-processing-pipeline)
9. [Invoice Status Lifecycle](#9-invoice-status-lifecycle)
10. [Background Workers & Cron Jobs](#10-background-workers--cron-jobs)
11. [Security](#11-security)
12. [Configuration Reference](#12-configuration-reference)
13. [Development Guide](#13-development-guide)
14. [Deployment](#14-deployment)
15. [Known Pending Items](#15-known-pending-items)

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Clients / ERP Systems                        │
│           Browser Dashboard  ·  ERP (API Key)  ·  Mobile App        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Fastify REST API                               │
│   CORS · Helmet · Rate-Limit · JWT / API Key Auth · Multipart       │
│                                                                      │
│   Auth  Tenants  Users  Invoices  Connectors  FieldMapping           │
│   Compliance  Archive  Webhooks  API Keys  Transmission              │
└────────┬──────────────────────────────────────────┬─────────────────┘
         │ Prisma ORM                               │ AWS SDK
         ▼                                          ▼
┌─────────────────┐    ┌───────────────────────────────────────────┐
│   PostgreSQL    │    │                 AWS                        │
│   (all data)    │    │  SQS (invoice queue · archive queue · DLQ) │
└─────────────────┘    │  S3  (invoice archive JSON + JWS)          │
                       │  Glacier (auto-transition after 90 days)   │
                       │  Secrets Manager (tenant signing keys)     │
                       └──────────────────────┬────────────────────┘
                                              │
                                              ▼
                                   ┌──────────────────┐
                                   │   BIR EIS API    │
                                   │  (sandbox / prod) │
                                   └──────────────────┘
```

**Request flow for invoice submission:**

```
Client → POST /invoices/:id/submit
       → DB: status DRAFT → QUEUED
       → SQS: enqueue message
       → Invoice Processor Worker:
           validate → format BIR JSON → sign JWS (RS256)
           → transmit to BIR → update status
           → fire webhooks → archive to S3
```

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.5 (strict) |
| Framework | Fastify v5 |
| ORM | Prisma 5 |
| Database | PostgreSQL 15+ |
| Queue | AWS SQS (FIFO) |
| Object Storage | AWS S3 + S3 Glacier |
| Secrets | AWS Secrets Manager |
| Signing | JWS RS256 via `jose` |
| Auth | `@fastify/jwt` (HS256) + bcrypt API keys |
| Validation | Zod + AJV (Fastify native) |
| Logging | Pino (structured JSON) |
| Testing | Vitest |
| Deploy | AWS Lambda (`@fastify/aws-lambda`) + ECS fallback |
| AI Field Mapping | OpenAI GPT-4o (fallback: Levenshtein fuzzy) |

---

## 3. Project Structure

```
src/
├── server.ts              Lambda handler + local ECS entrypoint
├── app.ts                 Fastify app factory, plugin registration, cron setup
│
├── config/
│   ├── env.ts             Zod-validated environment variables (parsed at startup)
│   └── aws.ts             AWS SDK client singletons (SQS, S3, Secrets Manager)
│
├── lib/
│   ├── bir-client.ts      BIR EIS HTTP client (retry + transmission logging)
│   ├── bir-formatter.ts   Invoice → BIR JSON schema transformer
│   ├── jws.ts             JWS RS256 signing via tenant key from Secrets Manager
│   ├── validator.ts       BIR payload field validation
│   ├── crypto.ts          AES-256-GCM encrypt/decrypt + HMAC webhook signing
│   ├── logger.ts          Pino logger with secret field redaction
│   └── request-context.ts assertUser() / assertApiKey() helpers
│
├── plugins/
│   ├── prisma.ts          PrismaClient Fastify decorator
│   ├── auth.ts            JWT + API key authenticate decorators + requireScope()
│   ├── rateLimit.ts       60 req/min per tenant (exclude /healthz)
│   └── multipart.ts       File upload (50 MB max, 1 file per request)
│
├── types/
│   ├── fastify.d.ts       Module augmentation: request.user, request.apiKey
│   ├── bir.types.ts       BIR EIS payload, response, and JWS types
│   └── tenant.types.ts    UserContext, ApiKeyContext, TenantContext, pagination
│
├── modules/
│   ├── auth/              Register tenant, login, refresh token, logout
│   ├── tenants/           Tenant CRUD + BIR credential management
│   ├── users/             User CRUD, role management, password change
│   ├── invoices/          Invoice CRUD, submit, sync-status, cancel, archive
│   ├── connectors/        File upload/import (Excel/CSV/JSON), connector configs
│   ├── fieldMapping/      AI field mapping suggestions + template CRUD
│   ├── compliance/        Dashboard metrics, audit log, BIR API health
│   ├── archive/           S3 archive retrieval + Glacier restore
│   ├── webhooks/          Outbound webhook endpoint CRUD + delivery history
│   ├── apiKeys/           API key creation, listing, revocation
│   └── transmission/      BIR transmission attempt log
│
└── workers/
    ├── invoiceProcessor.worker.ts   SQS consumer: full BIR pipeline per invoice
    ├── archiver.worker.ts           SQS consumer: S3 archive upload
    ├── retryTransmission.worker.ts  Cron: re-attempt REJECTED invoices
    └── webhookRetry.worker.ts       Cron: re-attempt failed webhook deliveries
```

---

## 4. Core Invariants

These rules are enforced throughout the codebase and must never be violated.

### Multi-tenancy
Every Prisma query in service functions **must** include `where: { tenantId }`. The tenant ID comes from the JWT payload (`request.user.tenantId`) or the API key (`request.apiKey.tenantId`), never from user-supplied request parameters.

### Money representation
All monetary amounts are stored as **`BigInt` centavos** in the database (1 PHP = 100 centavos). Floating-point arithmetic is never used for money. Amounts are formatted to PHP decimal strings (`"PHP 1,234.56"`) only at the API response boundary in `invoices.transformer.ts`.

```
1,000 PHP = 100000 centavos (stored as BigInt)
```

### BIR credentials
BIR API credentials (username/password) stored in `Tenant.birCredentialsEncrypted` are **AES-256-GCM encrypted** before writing and decrypted only at transmission time. They must never be logged. Tenant signing private keys are stored exclusively in AWS Secrets Manager — only the ARN is stored in the database.

### Secret field redaction
The Pino logger in `lib/logger.ts` redacts the fields `privateKey`, `bir_credentials`, `password`, and `apiKey` from all log output, replacing them with `[REDACTED]`.

### Idempotency
The SQS invoice processor checks `invoice.status === 'ACCEPTED'` before processing and uses an atomic `updateMany` status claim as an optimistic lock to prevent double-processing when two worker instances compete on the same message after a visibility timeout.

---

## 5. Authentication & Authorization

### JWT (browser / user sessions)
- **Access token**: HS256, 15-minute expiry, signed with `JWT_SECRET`
- **Refresh token**: random 48-byte token, SHA-256 hashed before DB storage, 7-day expiry
- Refresh tokens are **rotated on every use** — the old token is revoked atomically when the new one is created (TOCTOU-safe via DB transaction)
- Sessions are revoked on password change and on account deletion

### API keys (machine-to-machine)
- Format: `eir_live_<random>` (production) or `eir_test_<random>` (test)
- Only the **bcrypt hash** is stored — plaintext is returned once on creation
- Scoped: `INVOICE_READ`, `INVOICE_WRITE`, `INVOICE_SUBMIT`, `CONNECTOR_READ`, `CONNECTOR_WRITE`, `COMPLIANCE_READ`, `WEBHOOK_READ`, `WEBHOOK_WRITE`, `ADMIN`
- Scope is enforced per-route with `fastify.requireScope()`

### Role hierarchy (JWT users)

```
OWNER  >  ADMIN  >  ACCOUNTANT  >  VIEWER
  4          3            2            1
```

- **OWNER**: full access; only role that can manage other OWNERs/ADMINs
- **ADMIN**: can create/modify ACCOUNTANT and VIEWER users; can manage invoices, connectors, webhooks, API keys
- **ACCOUNTANT**: can create, update, and submit invoices; read-only on most other resources
- **VIEWER**: read-only across all resources

Actors can only manage users of strictly lower rank and cannot assign roles equal to or above their own.

---

## 6. API Surface

All endpoints require `Authorization: Bearer <accessToken>` unless noted.

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | None | DB connectivity, SQS/S3 config, BIR base URL |

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | None | Register new tenant + owner user; returns token pair |
| `POST` | `/auth/login` | None | Email/password login; returns token pair |
| `POST` | `/auth/refresh` | None | Rotate refresh token; returns new token pair |
| `POST` | `/auth/logout` | JWT | Revoke refresh token |

### Tenants
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/tenants/me` | Any | Own tenant profile |
| `GET` | `/tenants` | Superadmin | List all tenants (paginated) |
| `GET` | `/tenants/:id` | Any (own) / Superadmin | Get tenant by ID |
| `PATCH` | `/tenants/:id` | OWNER/ADMIN (own) / Superadmin | Update settings, BIR credentials |

### Users
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/users/me` | Any | Own user profile |
| `PATCH` | `/users/me` | Any | Update own first/last name |
| `POST` | `/users/me/password` | Any | Change own password (revokes all sessions) |
| `GET` | `/users` | OWNER/ADMIN | List all users in tenant |
| `GET` | `/users/:userId` | OWNER/ADMIN or self | Get user by ID |
| `POST` | `/users` | OWNER/ADMIN | Create user in tenant |
| `PATCH` | `/users/:userId` | OWNER/ADMIN | Update role, isActive, name |
| `DELETE` | `/users/:userId` | OWNER/ADMIN | Soft-delete user + revoke sessions |

### Invoices
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/invoices` | Any | List invoices (paginated, filterable) |
| `GET` | `/invoices/:id` | Any | Get invoice + line items |
| `POST` | `/invoices` | OWNER/ADMIN/ACCOUNTANT | Create DRAFT invoice |
| `PATCH` | `/invoices/:id` | OWNER/ADMIN/ACCOUNTANT | Update DRAFT invoice (atomic line item replace) |
| `POST` | `/invoices/:id/submit` | OWNER/ADMIN/ACCOUNTANT | Enqueue for BIR transmission |
| `POST` | `/invoices/:id/sync-status` | Any | Poll BIR for current status; update local record |
| `POST` | `/invoices/:id/cancel` | OWNER/ADMIN | Cancel invoice |
| `GET` | `/invoices/:id/archive` | Any | Get S3 presigned URL or Glacier restore status |

### Connectors
| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/connectors/upload` | OWNER/ADMIN/ACCOUNTANT | Parse Excel/CSV/JSON file; returns upload token |
| `POST` | `/connectors/import` | OWNER/ADMIN/ACCOUNTANT | Confirm field mapping; bulk-create invoices |
| `GET` | `/connectors` | Any | List saved connector configs |
| `POST` | `/connectors` | OWNER/ADMIN | Save connector config |
| `GET` | `/connectors/:id` | Any | Get connector config by ID |
| `DELETE` | `/connectors/:id` | OWNER/ADMIN | Soft-delete connector config |

### Field Mapping
| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/field-mapping/suggest` | Any | AI field mapping (OpenAI / Levenshtein fallback) |
| `GET` | `/field-mapping/templates` | Any | List saved mapping templates |
| `POST` | `/field-mapping/templates` | Any | Save mapping template |
| `DELETE` | `/field-mapping/templates/:id` | OWNER/ADMIN | Delete template |

### Compliance
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/compliance/summary` | Any | Invoice counts, 30-day transmission rate, YTD VAT |
| `GET` | `/compliance/audit-log` | Any | Immutable audit log (paginated, filterable) |
| `GET` | `/compliance/bir-status` | Any | BIR API health ping + latency |
| `GET` | `/transmissions` | Any | BIR transmission attempt log |

### API Keys
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api-keys` | OWNER/ADMIN | List API keys |
| `POST` | `/api-keys` | OWNER/ADMIN | Create API key (plaintext returned once) |
| `DELETE` | `/api-keys/:id` | OWNER/ADMIN | Revoke API key |

### Webhooks
| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/webhooks` | Any | List webhook endpoints |
| `POST` | `/webhooks` | OWNER/ADMIN | Register webhook endpoint |
| `PATCH` | `/webhooks/:id` | OWNER/ADMIN | Update URL, events, description, isActive |
| `DELETE` | `/webhooks/:id` | OWNER/ADMIN | Soft-delete webhook endpoint |
| `GET` | `/webhooks/:id/deliveries` | Any | Paginated delivery history |

---

## 7. Data Model

```
Tenant ─┬── User ──── RefreshToken
        ├── ApiKey
        ├── Invoice ──┬── InvoiceLineItem
        │             ├── Transmission
        │             └── ArchiveRecord
        ├── ConnectorConfig
        ├── FieldMappingTemplate
        ├── WebhookEndpoint ── WebhookDelivery
        └── AuditLog
```

### Key field notes

| Model | Field | Note |
|---|---|---|
| `Tenant` | `birCredentialsEncrypted` | AES-256-GCM ciphertext; never logged |
| `Tenant` | `birPrivateKeyArn` | ARN in Secrets Manager; key never leaves AWS |
| `Tenant` | `invoiceCounter` | Atomically incremented; used for invoice number generation |
| `User` | `passwordHash` | bcrypt (12 rounds); never returned in API responses |
| `RefreshToken` | `tokenHash` | SHA-256 of raw token; raw token never stored |
| `Invoice` | `*Centavos` | BigInt centavos; never float |
| `Invoice` | `birIref` | BIR-assigned Invoice Reference Number; `null` until ACCEPTED |
| `Invoice` | `jwsToken` | Compact JWS (RS256); persisted to survive crash-restart |
| `InvoiceLineItem` | `vatRateBps` | Basis points: 1200 = 12%, 0 = zero-rated/exempt |
| `ArchiveRecord` | `retentionUntil` | Invoice date + 10 years (BIR requirement) |
| `WebhookEndpoint` | `secret` | HMAC-SHA256 signing secret; returned once on creation |
| `WebhookDelivery` | `nextRetryAt` | Set by retry worker for exponential backoff |

---

## 8. Invoice Processing Pipeline

The SQS consumer in `invoiceProcessor.worker.ts` performs the complete BIR submission pipeline for each message:

```
SQS Message { invoiceId, tenantId }
       │
       ▼
1. Load invoice from DB (include lineItems + tenant)
       │
       ▼
2. Idempotency check — skip if already ACCEPTED
       │
       ▼
3. Atomic status claim:  UPDATE WHERE status IN (QUEUED, REJECTED, SIGNING, TRANSMITTING)
                         SET status = SIGNING
                         (prevents two workers racing on same invoice)
       │
       ▼
4. Format to BIR JSON  (bir-formatter.ts)
   — converts BigInt centavos → PHP decimal strings
   — builds BIR seller/buyer/lineItem structure
       │
       ▼
5. Validate BIR fields  (validator.ts)
   — TIN format, required fields, numeric ranges
   — on failure: mark REJECTED, delete SQS message
       │
       ▼
6. Sign payload  (jws.ts)
   — fetch RSA private key from AWS Secrets Manager
   — produce compact JWS (RS256)
   — persist jwsToken to DB (crash recovery: re-use if already signed)
   — update status → TRANSMITTING
       │
       ▼
7. Transmit to BIR EIS API  (bir-client.ts)
   — POST /v1/invoices with JWS
   — retry up to 3× with exponential backoff
   — every attempt logged to Transmission table
       │
       ├─ ACCEPTED ──► update status, store birIref + birAcceptedAt
       │                fire INVOICE_ACCEPTED webhook
       │                archive to S3  (archive.service.ts)
       │
       └─ REJECTED ──► update status, store birResponse
                        fire INVOICE_REJECTED webhook
                        (retry worker will re-attempt with backoff)
```

**Crash recovery**: If the worker crashes between signing and transmission, the next SQS delivery reuses the existing `jwsToken` rather than re-signing with a new nonce.

**DLQ**: SQS automatically moves messages to the Dead Letter Queue after `maxReceiveCount` failed deliveries. The `TRANSMISSION_FAILED` webhook event fires on each failure.

---

## 9. Invoice Status Lifecycle

```
                    ┌───────────────────────────────────────────────┐
  POST /invoices    │                                               │
        │           │        SQS Worker                            │
        ▼           │                                               │
      DRAFT ──submit──► QUEUED ──► SIGNING ──► TRANSMITTING ──┬──► ACCEPTED ──► ARCHIVED
        │                                                      │
        │                                                      └──► REJECTED
        │                                                               │
        │                                                      retry worker (cron)
        │                                                               │
        │                                                      (up to 3 attempts)
        │
        └── cancel ──► CANCELLED  (also valid from QUEUED/SIGNING/TRANSMITTING)
```

| Status | Description |
|---|---|
| `DRAFT` | Created; editable; not yet submitted |
| `QUEUED` | Enqueued in SQS; awaiting worker pickup |
| `SIGNING` | Worker has claimed the invoice; signing JWS |
| `TRANSMITTING` | JWS signed; HTTP call to BIR in progress |
| `ACCEPTED` | BIR accepted; `birIref` assigned |
| `REJECTED` | BIR rejected or validation failed; eligible for retry |
| `CANCELLED` | Cancelled by user; `cancelReason` recorded |
| `ARCHIVED` | Accepted and uploaded to S3 |

---

## 10. Background Workers & Cron Jobs

| Name | Trigger | Frequency | Purpose |
|---|---|---|---|
| Invoice Processor | SQS long-poll | Continuous | Full BIR submission pipeline |
| Archiver | SQS long-poll | Continuous | Upload accepted invoices to S3 |
| Retry Transmission | Cron | Every 5 min | Re-submit REJECTED invoices with backoff |
| Webhook Retry | Cron | Every 1 min | Re-deliver failed webhook events |
| Refresh Token Cleanup | Cron | Daily 03:00 | Delete expired/revoked tokens older than 7 days |

### Webhook retry backoff schedule

| Attempt | Delay before retry |
|---|---|
| 1st retry | 1 minute |
| 2nd retry | 5 minutes |
| 3rd retry | 30 minutes |
| 4th retry | 2 hours |
| 5th retry | 8 hours |
| After 5 attempts | Give up (delivery marked permanently failed) |

### BIR transmission retry backoff

| Attempt | Delay before retry |
|---|---|
| 1st retry | 5 minutes |
| 2nd retry | 15 minutes |
| 3rd retry | 60 minutes |
| After 3 attempts | Stop (manual resubmit required) |

---

## 11. Security

| Control | Implementation |
|---|---|
| Transport | TLS enforced at load balancer; `trustProxy: true` in Fastify |
| CORS | `@fastify/cors` — origin allowlist via `CORS_ORIGINS` env var; block-all in production if unset |
| Security headers | `@fastify/helmet` (CSP disabled — API only) |
| Rate limiting | `@fastify/rate-limit` — 60 req/min per tenant (keyed by tenantId or IP); `/healthz` exempt |
| Authentication | JWT HS256 (15 min) + bcrypt API keys; refresh tokens SHA-256 hashed at rest |
| Authorization | Role-rank enforcement in every service; multi-tenancy enforced at every Prisma query |
| Secrets at rest | BIR credentials: AES-256-GCM. Signing keys: AWS Secrets Manager. API keys: bcrypt. Refresh tokens: SHA-256 |
| Log redaction | Pino redacts `privateKey`, `bir_credentials`, `password`, `apiKey` from all log output |
| SSRF protection | Webhook URLs validated against private IP ranges: `10.x`, `172.16–31.x`, `192.168.x`, `127.x`, `169.254.x` (AWS metadata), `::1`, ULA, link-local |
| Idempotency | SQS FIFO dedup by `invoiceId`; worker-level optimistic lock on invoice status |
| Audit trail | Immutable `AuditLog` table records every CREATE/UPDATE/DELETE/SUBMIT/CANCEL/ARCHIVE/RETRIEVE action with actor, diff, and timestamp |

---

## 12. Configuration Reference

All variables are validated at startup by `src/config/env.ts` (Zod). The server will refuse to start if required variables are missing.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Min 32 chars, min 12 unique chars; signs access tokens |
| `JWT_REFRESH_SECRET` | Same requirements; signs refresh tokens |

### Optional — features degrade gracefully when absent

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port (local/ECS only) |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `AWS_REGION` | `ap-southeast-1` | AWS region for all SDK clients |
| `AWS_ACCESS_KEY_ID` | — | AWS credentials (omit to use instance role) |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials |
| `SQS_INVOICE_QUEUE_URL` | — | FIFO queue for invoice processing; queue disabled if absent |
| `SQS_ARCHIVE_QUEUE_URL` | — | FIFO queue for S3 archival; archiver disabled if absent |
| `SQS_DLQ_URL` | — | Dead Letter Queue URL |
| `S3_BUCKET` | — | Bucket for invoice archive; archival skipped if absent |
| `GLACIER_VAULT` | — | Glacier vault name |
| `ENCRYPTION_KEY` | — | 64 hex chars (32 bytes) for AES-256-GCM BIR credential encryption |
| `SECRETS_MANAGER_KEY_ARN` | — | ARN for tenant JWS signing key store |
| `BIR_API_BASE_URL` | `https://sandbox.bir.gov.ph/eis` | BIR EIS API base URL |
| `BIR_API_KEY` | — | Bearer token for BIR API; transmission disabled if absent |
| `OPENAI_API_KEY` | — | GPT-4o for AI field mapping; falls back to fuzzy match |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model ID |
| `CORS_ORIGINS` | (block-all in prod) | Comma-separated allowed origins, e.g. `https://app.eis-ready.ph` |
| `RATE_LIMIT_PER_MINUTE` | `100` | Requests per minute per tenant |
| `SUPERADMIN_EMAIL` | — | Email address with superadmin access to list all tenants |

---

## 13. Development Guide

### First-time setup

```bash
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY

npm install
npx prisma migrate dev --name init
npm run dev
```

### Key commands

```bash
npm run dev              # Start with tsx watch (hot reload)
npm test                 # Run unit tests (Vitest)
npm run test:coverage    # Tests + coverage report
npm run build            # Compile TypeScript → dist/
npm run lint             # Type-check only (tsc --noEmit)
npx prisma studio        # Visual DB browser
npx prisma migrate dev   # Apply schema changes
npx prisma generate      # Regenerate Prisma client after schema edits
```

### Adding a new feature module

1. Create `src/modules/<name>/` with `<name>.schema.ts`, `<name>.service.ts`, `<name>.routes.ts`
2. All service functions must accept `prisma: PrismaClient` — never instantiate their own
3. Every Prisma query must include `where: { tenantId }` for tenant-scoped resources
4. Import and register the routes plugin in `src/app.ts`
5. Add a corresponding folder to the Postman collection at `docs/EIS-Ready.postman_collection.json`

### Money arithmetic

```typescript
// CORRECT — integer centavos
const total = BigInt(unitPriceCentavos) * BigInt(quantity) - BigInt(discountCentavos);

// WRONG — never use float for money
const total = unitPrice * quantity; // ❌
```

### Finding unresolved BIR API details

```bash
grep -r "TODO: confirm with BIR" src/
```

---

## 14. Deployment

### AWS Lambda (primary)

The Fastify app is wrapped with `@fastify/aws-lambda` in `src/server.ts`. The exported `handler` function is the Lambda entrypoint. SQS workers are **not** started in Lambda — they run as separate ECS tasks or Lambda consumers.

```
Lambda:     API Gateway → handler → Fastify
ECS Tasks:  invoiceProcessor.worker, archiver.worker
Cron:       EventBridge → Lambda → retryFailedTransmissions, retryFailedWebhooks
```

### ECS fallback

Run `npm start` (after `npm run build`) to start the HTTP server on `PORT`. In this mode, all SQS workers are started automatically if the queue URLs and AWS credentials are configured.

### Environment-specific notes

- Set `NODE_ENV=production` in all production deployments
- `CORS_ORIGINS` must be explicitly set in production (defaults to block-all)
- Per-tenant BIR endpoints can be overridden via `Tenant.birApiEndpoint` in the DB

---

## 15. Known Pending Items

The following BIR API specifics are unconfirmed pending official EIS documentation. Search `TODO: confirm with BIR` in the source for exact locations.

| Item | File | Status |
|---|---|---|
| Submission endpoint path (`/v1/invoices` assumed) | `lib/bir-client.ts` | Unconfirmed |
| Auth method: Bearer token vs. mTLS | `lib/bir-client.ts` | Bearer implemented; mTLS stubbed |
| JSON schema version string (`"1.0"` assumed) | `lib/bir-formatter.ts` | Unconfirmed |
| TIN format validation rules | `lib/validator.ts` | Partial |
| Cancellation endpoint path and method | `lib/bir-client.ts` | POST assumed |
| BIR response envelope field names | `types/bir.types.ts` | Estimated |
| BIR health check endpoint path | `lib/bir-client.ts` | `/health` assumed |
| Status polling endpoint path | `lib/bir-client.ts` | `/v1/invoices/:iref/status` assumed |
