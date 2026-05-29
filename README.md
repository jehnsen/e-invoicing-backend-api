# E-Invoicing Backend API

Philippine BIR EIS compliance SaaS middleware backend.

## Quick Start

```bash
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev
```

## Architecture

- **Runtime**: Node.js 20 LTS, TypeScript
- **Framework**: Fastify v4
- **Database**: PostgreSQL + Prisma ORM
- **Queue**: AWS SQS
- **Storage**: AWS S3 + Glacier
- **Auth**: JWT + API Keys
- **Signing**: JWS RS256 per BIR RR 11-2025
- **Deploy**: AWS Lambda + ECS

## Key Features

- Multi-tenant invoice processing
- BIR EIS compliance
- 10-year archive support
- JWT + API Key authentication
- Rate limiting & security

## Project Structure

```
src/
├── config/       Environment & AWS clients
├── lib/          JWS, BIR client, validators
├── plugins/      Fastify plugins
├── modules/      Feature modules
├── workers/      SQS consumers
├── types/        Type definitions
├── app.ts        App factory
└── server.ts     Entry point
```

## Commands

```bash
npm run dev              # Local development
npm test                 # Run tests
npm run build            # Compile TypeScript
npx prisma studio       # Database browser
```

## Critical Rules

- **Multi-tenancy**: Every query includes `tenantId`
- **Money**: Store as `BigInt` centavos
- **Secrets**: Auto-redacted in logs
- **BIR credentials**: AES-256-GCM encrypted
- **Idempotency**: Check status before SQS processing

## Environment Variables

See `.env.example`. Minimum required:
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
