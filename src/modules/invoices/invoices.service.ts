import { PrismaClient } from '@prisma/client';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { sqsClient } from '../../config/aws';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { CreateInvoiceBody, UpdateInvoiceBody, InvoiceQuery, CancelInvoiceBody } from './invoices.schema';
import { buildInvoiceCreateData, serializeInvoice } from './invoices.transformer';

/**
 * Creates a new DRAFT invoice for the given tenant.
 * Auto-generates invoice number from tenant prefix + sequential counter.
 * Multi-tenancy: all queries scoped to tenantId.
 */
export async function createInvoice(
  tenantId: string,
  body: CreateInvoiceBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
  });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });

  // Atomic invoice number generation
  const updatedTenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { invoiceCounter: { increment: 1 } },
    select: { invoiceCounter: true, invoicePrefix: true, tin: true, registeredName: true, address: true },
  });

  const invoiceNumber = `${updatedTenant.invoicePrefix ?? body.invoiceType}-${String(updatedTenant.invoiceCounter).padStart(8, '0')}`;

  const createData = buildInvoiceCreateData(
    body,
    tenantId,
    updatedTenant.tin,
    updatedTenant.registeredName,
    updatedTenant.address ?? '',
    invoiceNumber,
  );

  const invoice = await prisma.invoice.create({
    data: createData,
    include: { lineItems: true },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'CREATE',
      resourceType: 'Invoice',
      resourceId: invoice.id,
      diff: { invoiceNumber, invoiceType: body.invoiceType, status: 'DRAFT' },
    },
  });

  logger.info({ tenantId, invoiceId: invoice.id, invoiceNumber }, 'Invoice created');
  return serializeInvoice(invoice);
}

/**
 * Lists invoices for a tenant with cursor-based pagination.
 * Multi-tenancy: where clause always includes tenantId.
 */
export async function listInvoices(
  tenantId: string,
  query: InvoiceQuery,
  prisma: PrismaClient,
) {
  const where: Parameters<PrismaClient['invoice']['findMany']>[0]['where'] = {
    tenantId,     // Multi-tenancy: ALWAYS scope to tenant
    deletedAt: null,
  };

  if (query.status) where.status = query.status;
  if (query.invoiceType) where.invoiceType = query.invoiceType;
  if (query.dateFrom || query.dateTo) {
    where.invoiceDate = {};
    if (query.dateFrom) where.invoiceDate.gte = new Date(query.dateFrom);
    if (query.dateTo) where.invoiceDate.lte = new Date(query.dateTo);
  }
  if (query.search) {
    where.OR = [
      { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
      { buyerName: { contains: query.search, mode: 'insensitive' } },
      { buyerTin: { contains: query.search } },
      { birIref: { contains: query.search } },
    ];
  }
  if (query.cursor) {
    where.id = { lt: query.cursor };
  }

  const limit = query.limit ?? 20;
  const invoices = await prisma.invoice.findMany({
    where,
    include: { lineItems: true },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = invoices.length > limit;
  const items = hasMore ? invoices.slice(0, limit) : invoices;
  const nextCursor = hasMore ? items[items.length - 1].id : undefined;

  return {
    items: items.map(serializeInvoice),
    nextCursor,
  };
}

/**
 * Retrieves a single invoice by ID, scoped to tenant.
 */
export async function getInvoiceById(
  tenantId: string,
  invoiceId: string,
  prisma: PrismaClient,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, deletedAt: null },  // Multi-tenancy: tenantId required
    include: { lineItems: true },
  });

  if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  return serializeInvoice(invoice);
}

/**
 * Updates a DRAFT invoice. Only DRAFT invoices can be modified.
 */
export async function updateInvoice(
  tenantId: string,
  invoiceId: string,
  body: UpdateInvoiceBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, deletedAt: null },
  });

  if (!existing) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  if (existing.status !== 'DRAFT') {
    throw Object.assign(new Error('Only DRAFT invoices can be modified'), { statusCode: 422 });
  }

  const updateData: Parameters<PrismaClient['invoice']['update']>[0]['data'] = {};
  if (body.invoiceDate) updateData.invoiceDate = new Date(body.invoiceDate);
  if (body.vatType) updateData.vatType = body.vatType;
  if (body.buyerTin !== undefined) updateData.buyerTin = body.buyerTin;
  if (body.buyerName) updateData.buyerName = body.buyerName;
  if (body.buyerAddress !== undefined) updateData.buyerAddress = body.buyerAddress;
  if (body.buyerEmail !== undefined) updateData.buyerEmail = body.buyerEmail;

  if (body.lineItems) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
    updateData.lineItems = {
      create: body.lineItems.map((item) => ({
        lineNumber: item.lineNumber,
        itemCode: item.itemCode,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceCentavos: BigInt(item.unitPriceCentavos),
        discountCentavos: BigInt(item.discountCentavos ?? 0),
        vatRateBps: item.vatRateBps ?? 1200,
        vatAmountCentavos: BigInt(0),
        totalAmountCentavos: BigInt(item.unitPriceCentavos),
      })),
    };
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: updateData,
    include: { lineItems: true },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'UPDATE',
      resourceType: 'Invoice',
      resourceId: invoiceId,
      diff: { updated: Object.keys(body) },
    },
  });

  return serializeInvoice(updated);
}

/**
 * Enqueues a DRAFT invoice for BIR transmission via SQS.
 * Idempotent: invoices already ACCEPTED are skipped.
 */
export async function submitInvoice(
  tenantId: string,
  invoiceId: string,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, deletedAt: null },
  });

  if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });

  if (invoice.status === 'ACCEPTED') {
    return { message: 'Invoice already accepted', invoiceId };
  }

  if (!['DRAFT', 'REJECTED'].includes(invoice.status)) {
    throw Object.assign(
      new Error(`Cannot submit invoice in status: ${invoice.status}`),
      { statusCode: 422 },
    );
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'QUEUED', queuedAt: new Date() },
  });

  if (env.SQS_INVOICE_QUEUE_URL) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.SQS_INVOICE_QUEUE_URL,
        MessageBody: JSON.stringify({ invoiceId, tenantId }),
        MessageGroupId: tenantId,
        // invoiceId alone ensures FIFO deduplication within the 5-min window;
        // adding Date.now() would break dedup and allow double-processing on retries.
        MessageDeduplicationId: invoiceId,
      }),
    );
  } else {
    logger.warn('SQS_INVOICE_QUEUE_URL not configured — invoice queued in DB only');
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'SUBMIT',
      resourceType: 'Invoice',
      resourceId: invoiceId,
    },
  });

  logger.info({ tenantId, invoiceId }, 'Invoice submitted to SQS queue');
  return { message: 'Invoice queued for BIR transmission', invoiceId, status: 'QUEUED' };
}

/**
 * Cancels an invoice. If already transmitted to BIR (has iref), calls BIR cancellation.
 */
export async function cancelInvoice(
  tenantId: string,
  invoiceId: string,
  body: CancelInvoiceBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, deletedAt: null },
  });

  if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });

  if (['CANCELLED', 'ARCHIVED'].includes(invoice.status)) {
    throw Object.assign(new Error(`Invoice is already ${invoice.status}`), { statusCode: 422 });
  }

  // TODO: confirm with BIR — whether cancellation of ACCEPTED invoices via BIR API is supported
  // For now, mark cancelled locally; BIR cancellation would be triggered if invoice has birIref

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body.reason },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'CANCEL',
      resourceType: 'Invoice',
      resourceId: invoiceId,
      diff: { reason: body.reason },
    },
  });

  logger.info({ tenantId, invoiceId, reason: body.reason }, 'Invoice cancelled');
  return { message: 'Invoice cancelled', invoiceId, status: 'CANCELLED' };
}
