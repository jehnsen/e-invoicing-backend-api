# EIS Ready Backend — CLAUDE.md

Philippine BIR EIS compliance SaaS middleware backend.

## Quick Start

```bash
cp .env.example .env
# Edit .env with real values

npm install
npx prisma migrate dev --name init
npm run dev
```

## Architecture

- **Runtime**: Node.js 20 LTS, TypeScript
- **Framework**: Fastify v4
- **Database**: PostgreSQL via Prisma ORM
- **Queue**: AWS SQS (invoice processing, archival)
- **Storage**: AWS S3 + Glacier (10-year archive)
- **Auth**: JWT (15min access, 7-day refresh) + API Keys (bcrypt-hashed)
- **Signing**: JWS RS256 per BIR RR 11-2025
- **Deploy**: AWS Lambda (`@fastify/aws-lambda`) + ECS fallback

## Project Structure

```
src/
├── config/       env validation (Zod) + AWS SDK clients
├── lib/          jws, bir-client, bir-formatter, validator, crypto, logger
├── plugins/      Fastify plugins: prisma, auth, rateLimit, multipart
├── modules/      Feature modules (auth, invoices, connectors, etc.)
├── workers/      SQS consumers (invoice processor, archiver, retry)
├── types/        BIR EIS types, tenant types, Fastify augmentation
├── app.ts        Fastify app factory
└── server.ts     Lambda handler + local entrypoint
```

## Critical Rules

1. **Multi-tenancy**: Every Prisma query in services MUST include `where: { tenantId }`.
2. **Money**: ALL amounts stored as `BigInt` centavos in DB. Format to PHP decimal only at API response.
3. **Secrets**: Fields `privateKey`, `bir_credentials`, `password`, `apiKey` are [REDACTED] by Pino logger.
4. **BIR credentials**: NEVER log. Encrypted with AES-256-GCM before DB storage.
5. **Idempotency**: SQS workers check `invoice.status === 'ACCEPTED'` before processing.

## BIR TODO Items

Search for `TODO: confirm with BIR` to find all unresolved BIR API specifics:
- Submission endpoint path
- Auth method (Bearer token vs. mTLS)
- JSON schema version string
- TIN format validation rules
- Cancellation endpoint
- Response envelope format

## Key Commands

```bash
npm run dev              # Start local dev server (tsx watch)
npm test                 # Run unit tests (vitest)
npm run test:coverage    # Test + coverage report
npx prisma studio        # Database browser
npx prisma migrate dev   # Apply schema migrations
npm run build            # Compile TypeScript to dist/
```

## Environment Variables

See `.env.example` for all required variables. Minimum for local dev:
- `DATABASE_URL`
- `JWT_SECRET` (32+ chars)
- `JWT_REFRESH_SECRET` (32+ chars)
- `ENCRYPTION_KEY` (64 hex chars = 32 bytes)

Optional (features degrade gracefully when absent):
- `ANTHROPIC_API_KEY` — falls back to fuzzy field mapping
- `SQS_INVOICE_QUEUE_URL` — queue-based processing disabled
- `S3_BUCKET` — archival disabled
- `BIR_API_KEY` — BIR transmission disabled

## Invoice Status Lifecycle

```
DRAFT → QUEUED → SIGNING → TRANSMITTING → ACCEPTED → ARCHIVED
                                        ↘ REJECTED (retried via cron)
DRAFT/QUEUED/SIGNING/TRANSMITTING → CANCELLED
```

## API Key Formats

- `eir_live_<random>` — production keys
- `eir_test_<random>` — test keys
- Only bcrypt hash stored — plaintext returned once on creation
