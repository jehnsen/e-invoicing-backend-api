# EIS Ready — System Workflow Documentation

Philippine BIR EIS (Electronic Invoicing System) compliance SaaS middleware.

---

## Table of Contents

1. [Tenant Onboarding](#1-tenant-onboarding)
2. [User Authentication](#2-user-authentication)
3. [Invoice Lifecycle](#3-invoice-lifecycle)
4. [Bulk Import via Connectors](#4-bulk-import-via-connectors)
5. [BIR Transmission Pipeline](#5-bir-transmission-pipeline)
6. [AI Field Mapping](#6-ai-field-mapping)
7. [Archival & Retrieval](#7-archival--retrieval)
8. [Webhook Event Delivery](#8-webhook-event-delivery)
9. [API Key (M2M) Access](#9-api-key-m2m-access)
10. [Compliance Dashboard](#10-compliance-dashboard)
11. [Error & Retry Handling](#11-error--retry-handling)

---

## 1. Tenant Onboarding

```
Client                        API                          Database
  │                             │                              │
  │  POST /auth/register        │                              │
  │  {tin, registeredName,      │                              │
  │   ownerEmail, password}     │                              │
  │ ─────────────────────────► │                              │
  │                             │  Check TIN + email unique    │
  │                             │ ────────────────────────────►│
  │                             │                              │
  │                             │  CREATE Tenant (TRIAL plan)  │
  │                             │  CREATE User (OWNER role)    │
  │                             │  CREATE AuditLog             │
  │                             │ ────────────────────────────►│
  │                             │                              │
  │                             │  Issue JWT access (15min)    │
  │                             │  + refresh token (7 days)    │
  │ ◄───────────────────────── │                              │
  │  { accessToken,             │                              │
  │    refreshToken }           │                              │
```

**Key rules:**
- Tenant starts in `TRIAL` status — upgrade to `ACTIVE` via superadmin PATCH
- Owner must configure BIR credentials (`PATCH /tenants/:id`) before invoices can be transmitted
- BIR private key ARN (AWS Secrets Manager) must be set for JWS signing to work

---

## 2. User Authentication

### Login & Token Rotation

```
Client                        API
  │                             │
  │  POST /auth/login           │
  │  { email, password }        │
  │ ─────────────────────────► │  bcrypt.compare(password, hash)
  │                             │  Issue access token (15min, HS256)
  │                             │  Store hashed refresh token in DB
  │ ◄───────────────────────── │
  │  { accessToken,             │
  │    refreshToken }           │
  │                             │
  │  POST /auth/refresh         │  Verify SHA-256 hash of token
  │  { refreshToken }           │  Revoke old token (rotate on use)
  │ ─────────────────────────► │  Issue new token pair
  │ ◄───────────────────────── │
  │  { accessToken,             │
  │    refreshToken }           │
```

### API Key Auth (Machine-to-Machine)

```
Client                        API
  │                             │
  │  Authorization:             │
  │  Bearer eir_live_<random>   │
  │ ─────────────────────────► │  Load all active API keys for tenant
  │                             │  bcrypt.compare(raw, stored hash)
  │                             │  Attach tenant + scopes to request
  │ ◄───────────────────────── │
  │  { response }               │
```

**Token lifetimes:**

| Token | Lifetime | Storage |
|---|---|---|
| Access JWT | 15 minutes | Client memory only |
| Refresh token | 7 days | SHA-256 hash in DB |
| API key | Until revoked / expires | bcrypt hash in DB |

---

## 3. Invoice Lifecycle

```
         ┌─────────┐
         │  DRAFT  │  ◄── Created via POST /invoices or bulk import
         └────┬────┘
              │ POST /invoices/:id/submit
              ▼
         ┌─────────┐
         │ QUEUED  │  ◄── Enqueued to SQS_INVOICE_QUEUE
         └────┬────┘
              │ Worker picks up message
              ▼
         ┌─────────┐
         │ SIGNING │  ◄── JWS RS256 signing via tenant private key
         └────┬────┘
              │ Signing complete
              ▼
         ┌──────────────┐
         │ TRANSMITTING │  ◄── HTTP POST to BIR EIS API
         └──────┬───────┘
                │
        ┌───────┴────────┐
        ▼                ▼
   ┌──────────┐    ┌──────────┐
   │ ACCEPTED │    │ REJECTED │
   └────┬─────┘    └────┬─────┘
        │               │ Retry cron (every 5 min)
        ▼               │ up to 3 attempts
   ┌──────────┐          │
   │ ARCHIVED │          ▼
   └──────────┘    REJECTED (permanent)
```

**Also reachable at any stage:**

```
DRAFT / QUEUED / SIGNING / TRANSMITTING / ACCEPTED
    │
    ▼  POST /invoices/:id/cancel
CANCELLED
```

---

## 4. Bulk Import via Connectors

```
User                     API                        Workers
  │                        │                            │
  │  POST /connectors/upload│                            │
  │  (multipart: .xlsx/     │                            │
  │   .csv/.json file)      │                            │
  │ ──────────────────────► │                            │
  │                         │  Parse file                │
  │                         │  Detect headers            │
  │                         │  Extract first 5 rows      │
  │                         │  Call AI field mapping ──► OpenAI API
  │                         │  Store rows in memory      │
  │                         │  with uploadToken (30min)  │
  │ ◄────────────────────── │                            │
  │  { uploadToken,         │                            │
  │    headers,             │                            │
  │    previewRows,         │                            │
  │    mappingSuggestions } │                            │
  │                         │                            │
  │  (User reviews mapping) │                            │
  │                         │                            │
  │  POST /connectors/import│                            │
  │  { uploadToken,         │                            │
  │    fieldMapping: [      │                            │
  │     {source, target}    │                            │
  │    ]}                   │                            │
  │ ──────────────────────► │                            │
  │                         │  Apply mapping to each row │
  │                         │  CREATE Invoice (DRAFT)    │
  │                         │  per row                   │
  │ ◄────────────────────── │                            │
  │  { created: N,          │                            │
  │    failed: M,           │                            │
  │    invoiceIds: [...] }  │                            │
```

**Supported file types:**

| Format | Library | Notes |
|---|---|---|
| `.xlsx` / `.xls` | `xlsx` | Multi-sheet; auto-detects header row |
| `.csv` | built-in parser | BOM-stripped; auto-detects delimiter (`,` `;` `\t` `\|`) |
| `.json` | built-in parser | Array, `{items:[]}`, `{data:[]}`, or single object |

---

## 5. BIR Transmission Pipeline

```
SQS Queue                Worker                   BIR EIS API
    │                      │                           │
    │  Message:            │                           │
    │  {invoiceId,         │                           │
    │   tenantId}          │                           │
    │ ───────────────────► │                           │
    │                      │  Load Invoice + lineItems │
    │                      │  Check status ≠ ACCEPTED  │
    │                      │  (idempotency guard)      │
    │                      │                           │
    │                      │  formatToBirJson()        │
    │                      │  validateBirPayload()     │
    │                      │                           │
    │                      │  signInvoicePayload()     │
    │                      │  (RS256, key from         │
    │                      │   AWS Secrets Manager)    │
    │                      │                           │
    │                      │  status → TRANSMITTING    │
    │                      │                           │
    │                      │  POST /v1/invoices ──────►│
    │                      │                           │  Returns iref
    │                      │ ◄─────────────────────────│
    │                      │                           │
    │                      │  status → ACCEPTED        │
    │                      │  store birIref            │
    │                      │  log Transmission record  │
    │                      │                           │
    │                      │  deliverWebhookEvent()    │
    │                      │  archiveInvoice() → S3    │
    │  DELETE message      │                           │
    │ ◄─────────────────── │                           │
```

**What gets logged per attempt** (`Transmission` table):

| Field | Value |
|---|---|
| `attemptNumber` | 1, 2, 3 … |
| `statusCode` | HTTP status from BIR |
| `requestBody` | Full BIR JSON + JWS sent |
| `responseBody` | BIR response envelope |
| `durationMs` | Round-trip time |
| `success` | `true` / `false` |

---

## 6. AI Field Mapping

```
Client                   API                      OpenAI
  │                        │                          │
  │  POST /field-mapping/  │                          │
  │  suggest               │                          │
  │  { sampleRows,         │                          │
  │    sourceHeaders }     │                          │
  │ ──────────────────────►│                          │
  │                        │  OPENAI_API_KEY set?     │
  │                        │  ┌── YES ───────────────►│
  │                        │  │   chat.completions    │
  │                        │  │   gpt-4o              │
  │                        │  │ ◄─────────────────────│
  │                        │  │   Parse JSON array    │
  │                        │  │                       │
  │                        │  └── NO  (fallback)      │
  │                        │      Levenshtein fuzzy   │
  │                        │      match + alias table │
  │                        │      (incl. Tagalog)     │
  │ ◄──────────────────────│                          │
  │  { suggestions: [      │                          │
  │    { sourceField,      │                          │
  │      targetField,      │                          │
  │      confidence,       │                          │
  │      reason }          │                          │
  │  ]}                    │                          │
```

**Tagalog aliases supported in fuzzy fallback:**

| Tagalog | Maps to |
|---|---|
| Halaga | `amount` |
| Dami | `quantity` |
| Yunit | `unit` |
| Petsa | `invoiceDate` |
| Mamimili | `buyerName` |
| Presyo | `unitPriceCentavos` |
| Bawas | `discountCentavos` |
| Paglalarawan | `description` |
| Uri | `invoiceType` |

---

## 7. Archival & Retrieval

### Archive (automatic after ACCEPTED)

```
Worker                    S3                      Database
  │                        │                          │
  │  Invoice ACCEPTED       │                          │
  │                         │                          │
  │  Build archive payload  │                          │
  │  { birJson, jws, meta } │                          │
  │                         │                          │
  │  PUT object ───────────►│                          │
  │  Key: {tenantId}/       │                          │
  │    {year}/{month}/      │                          │
  │    {invoiceId}.json     │                          │
  │                         │                          │
  │  CREATE ArchiveRecord ──────────────────────────► │
  │  { s3Key, retentionUntil: invoiceDate + 10 years }│
  │                         │                          │
  │  UPDATE Invoice ─────────────────────────────────►│
  │  status → ARCHIVED      │                          │
```

**S3 Lifecycle (configured on bucket):**

```
Day 0        Day 90             Year 10
  │            │                    │
  ▼            ▼                    ▼
[S3 Standard] ──► [S3 Glacier] ──► [Deleted]
   Fast access    ~$0.004/GB/mo    BIR retention met
```

### Retrieve — `GET /invoices/:id/archive`

```
API                       S3 / Glacier
  │                            │
  │  HeadObject ──────────────►│
  │                            │
  │  ┌─ Object in S3 Standard  │
  │  │  Generate presigned URL │
  │  │  (valid 1 hour)         │
  │  │                         │
  │  └─ Object in Glacier      │
  │     RestoreObject()        │
  │     (Standard: 3-5 hours)  │
  │     Return status:         │
  │     "restore-initiated"    │
  │                            │
  ▼
Client polls again after restore completes
```

---

## 8. Webhook Event Delivery

```
System Event              webhooks.service           Tenant Endpoint
(e.g. Invoice ACCEPTED)        │                           │
  │                            │                           │
  │  deliverWebhookEvent()     │                           │
  │ ─────────────────────────► │                           │
  │                            │  Load active endpoints    │
  │                            │  for this tenant + event  │
  │                            │                           │
  │                            │  Sign payload:            │
  │                            │  HMAC-SHA256(payload,     │
  │                            │    endpoint.secret)       │
  │                            │                           │
  │                            │  POST to endpoint.url ───►│
  │                            │  Headers:                 │
  │                            │  X-EIS-Signature: sha256= │
  │                            │  X-EIS-Event: <event>     │
  │                            │                           │
  │                            │  Log WebhookDelivery      │
  │                            │  (success/fail, status)   │
```

**Events emitted:**

| Event | Trigger |
|---|---|
| `INVOICE_CREATED` | `POST /invoices` |
| `INVOICE_QUEUED` | `POST /invoices/:id/submit` |
| `INVOICE_ACCEPTED` | BIR returns ACCEPTED |
| `INVOICE_REJECTED` | BIR returns REJECTED |
| `INVOICE_CANCELLED` | `POST /invoices/:id/cancel` |
| `INVOICE_ARCHIVED` | Moved to S3 |
| `TRANSMISSION_FAILED` | Worker error / max retries |

**Verifying signatures on your endpoint:**

```js
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

---

## 9. API Key (M2M) Access

```
POST /api-keys
{ name, scopes: ['INVOICE_READ', 'INVOICE_SUBMIT'], isLive: true }

Response (plaintext shown ONCE):
{ plaintextKey: "eir_live_AbCdEf..." }
```

**Available scopes:**

| Scope | Allows |
|---|---|
| `INVOICE_READ` | GET /invoices, GET /invoices/:id |
| `INVOICE_WRITE` | POST/PATCH /invoices |
| `INVOICE_SUBMIT` | POST /invoices/:id/submit |
| `CONNECTOR_READ` | GET /connectors |
| `CONNECTOR_WRITE` | POST /connectors, POST /connectors/import |
| `COMPLIANCE_READ` | GET /compliance/* |
| `WEBHOOK_READ` | GET /webhooks |
| `WEBHOOK_WRITE` | POST/DELETE /webhooks |
| `ADMIN` | All of the above |

**Usage:**
```
Authorization: Bearer eir_live_AbCdEf...
```

---

## 10. Compliance Dashboard

```
GET /compliance/summary

Returns:
{
  "invoiceCounts": {
    "DRAFT": 12,
    "QUEUED": 3,
    "ACCEPTED": 847,
    "REJECTED": 5,
    "ARCHIVED": 820
  },
  "transmissions": {
    "total30d": 312,
    "successRate": 98.40,
    "avgDurationMs": 1240
  },
  "yearToDate": {
    "acceptedCount": 847,
    "totalVatPhp": "101640.00",
    "totalAmountPhp": "847200.00"
  },
  "recentRejections": [...]
}

GET /compliance/audit-log     — paginated, immutable action log
GET /compliance/bir-status    — BIR API ping + latency
```

---

## 11. Error & Retry Handling

### SQS Worker — Transient Failures

```
Message received
      │
      ▼
  Process fails (network, BIR 5xx)
      │
      │  Visibility timeout expires (5 min)
      │  Message becomes visible again
      ▼
  SQS retries automatically
      │
      │  After maxReceiveCount (default: 3)
      ▼
  Message moved to DLQ (SQS_DLQ_URL)
```

### Retry Cron — REJECTED Invoices

Runs every 5 minutes via `node-cron`:

```
Find REJECTED invoices where birIref IS NULL
(null iref = BIR never confirmed receipt — safe to retry)

For each:
  transmissionCount ≥ 3?  → skip (give up)
  Last attempt < backoff?  → skip (too soon)
    Attempt 1 backoff: 5 min
    Attempt 2 backoff: 15 min
    Attempt 3 backoff: 60 min

  Re-sign → Re-transmit → Update status
```

### BIR Client — Per-Request Retry

```
Attempt 1 ──► BIR API
  │ 429 Too Many Requests → wait 60s → retry
  │ 4xx Client Error      → throw (do not retry)
  │ 5xx / network error   → backoff → retry
  │
Attempt 2 (backoff: 1s)
Attempt 3 (backoff: 2s)
  │
Max retries exceeded → throw → SQS retries
```

### Money Handling — Never Float

```
DB storage:  BigInt centavos   (e.g. ₱1,120.00 → 112000n)
Computation: BigInt arithmetic (no floating-point rounding errors)
API output:  Decimal string    (e.g. "1120.00")

Rule: multiply by 100 on ingestion, divide by 100 on output.
```
