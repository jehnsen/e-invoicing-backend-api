-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'QUEUED', 'SIGNING', 'TRANSMITTING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SI', 'OR', 'DI', 'CN', 'DN');

-- CreateEnum
CREATE TYPE "VatType" AS ENUM ('VATABLE', 'ZERO_RATED', 'EXEMPT', 'MIXED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('EXCEL', 'CSV', 'JSON', 'QUICKBOOKS', 'SAP', 'POSTGRES', 'REST_WEBHOOK');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('INVOICE_READ', 'INVOICE_WRITE', 'INVOICE_SUBMIT', 'CONNECTOR_READ', 'CONNECTOR_WRITE', 'COMPLIANCE_READ', 'WEBHOOK_READ', 'WEBHOOK_WRITE', 'ADMIN');

-- CreateEnum
CREATE TYPE "WebhookEvent" AS ENUM ('INVOICE_CREATED', 'INVOICE_QUEUED', 'INVOICE_ACCEPTED', 'INVOICE_REJECTED', 'INVOICE_CANCELLED', 'INVOICE_ARCHIVED', 'TRANSMISSION_FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "tin" TEXT NOT NULL,
    "registeredName" TEXT NOT NULL,
    "tradeName" TEXT,
    "address" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "plan" "TenantPlan" NOT NULL DEFAULT 'STARTER',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "birCredentialsEncrypted" TEXT,
    "birPrivateKeyArn" TEXT,
    "birCertificateArn" TEXT,
    "birApiEndpoint" TEXT,
    "invoicePrefix" TEXT,
    "invoiceCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ACCOUNTANT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" "ApiKeyScope"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "vatType" "VatType" NOT NULL DEFAULT 'VATABLE',
    "sellerTin" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "buyerTin" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerAddress" TEXT,
    "buyerEmail" TEXT,
    "subtotalCentavos" BIGINT NOT NULL DEFAULT 0,
    "vatAmountCentavos" BIGINT NOT NULL DEFAULT 0,
    "discountCentavos" BIGINT NOT NULL DEFAULT 0,
    "totalAmountCentavos" BIGINT NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "birJson" JSONB,
    "jwsToken" TEXT,
    "birIref" TEXT,
    "birResponse" JSONB,
    "birSubmittedAt" TIMESTAMP(3),
    "birAcceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "queuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPriceCentavos" BIGINT NOT NULL,
    "discountCentavos" BIGINT NOT NULL DEFAULT 0,
    "vatRateBps" INTEGER NOT NULL DEFAULT 1200,
    "vatAmountCentavos" BIGINT NOT NULL DEFAULT 0,
    "totalAmountCentavos" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmissions" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "statusCode" INTEGER,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transmissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_configs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fieldMapping" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "connector_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mapping_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "ConnectorType" NOT NULL,
    "mapping" JSONB NOT NULL,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "field_mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_records" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "glacierId" TEXT,
    "glacierVault" TEXT,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "restoredUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "diff" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" "WebhookEvent"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "event" "WebhookEvent" NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tin_key" ON "tenants"("tin");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invoices_tenantId_invoiceDate_idx" ON "invoices"("tenantId", "invoiceDate");

-- CreateIndex
CREATE INDEX "invoices_birIref_idx" ON "invoices"("birIref");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_invoiceNumber_key" ON "invoices"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "transmissions_invoiceId_idx" ON "transmissions"("invoiceId");

-- CreateIndex
CREATE INDEX "transmissions_tenantId_sentAt_idx" ON "transmissions"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "archive_records_invoiceId_key" ON "archive_records"("invoiceId");

-- CreateIndex
CREATE INDEX "archive_records_tenantId_idx" ON "archive_records"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_configs" ADD CONSTRAINT "connector_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping_templates" ADD CONSTRAINT "field_mapping_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_records" ADD CONSTRAINT "archive_records_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
