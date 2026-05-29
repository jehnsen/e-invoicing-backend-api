import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { parseExcelBuffer } from './parsers/excel.parser';
import { parseCsvBuffer } from './parsers/csv.parser';
import { parseJsonBuffer } from './parsers/json.parser';
import { SaveConnectorBody, ImportBody } from './connectors.schema';
import { createInvoice } from '../invoices/invoices.service';
import { logger } from '../../lib/logger';

// In-memory upload token store — not safe for multi-instance deployments.
// Replace with Redis (SETEX + JSON) when running more than one process.
// Each entry holds parsed rows in memory; limit file size upstream to keep heap bounded.
const uploadTokenStore = new Map<string, { rows: Record<string, unknown>[]; headers: string[]; tenantId: string; expiresAt: number }>();

// Periodic TTL sweep — evicts entries that were never consumed (e.g. abandoned uploads).
// Without this, any request that uploads but never calls /import leaks memory indefinitely.
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of uploadTokenStore.entries()) {
    if (data.expiresAt < now) uploadTokenStore.delete(token);
  }
}, 5 * 60 * 1000).unref(); // .unref() so this timer doesn't prevent process exit

/**
 * Parses an uploaded file (Excel/CSV/JSON) and returns a preview of the first 5 rows
 * along with detected column headers. Returns an uploadToken for subsequent /import call.
 */
export async function processUpload(
  fileBuffer: Buffer,
  filename: string,
  tenantId: string,
): Promise<{ uploadToken: string; headers: string[]; previewRows: Record<string, unknown>[]; rowCount: number }> {
  const ext = filename.split('.').pop()?.toLowerCase();

  let headers: string[];
  let rows: Record<string, unknown>[];

  if (ext === 'xlsx' || ext === 'xls') {
    const result = parseExcelBuffer(fileBuffer);
    const firstSheet = result.sheets[0];
    if (!firstSheet) throw Object.assign(new Error('Excel file has no sheets'), { statusCode: 400 });
    headers = firstSheet.headers;
    rows = firstSheet.rows;
  } else if (ext === 'csv') {
    const result = parseCsvBuffer(fileBuffer);
    headers = result.headers;
    rows = result.rows;
  } else if (ext === 'json') {
    const result = parseJsonBuffer(fileBuffer);
    headers = result.headers;
    rows = result.rows;
  } else {
    throw Object.assign(
      new Error('Unsupported file type — upload .xlsx, .csv, or .json'),
      { statusCode: 400 },
    );
  }

  const uploadToken = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minute TTL

  uploadTokenStore.set(uploadToken, { rows, headers, tenantId, expiresAt });

  logger.info({ tenantId, filename, rowCount: rows.length }, 'File uploaded and parsed');

  return {
    uploadToken,
    headers,
    previewRows: rows.slice(0, 5),
    rowCount: rows.length,
  };
}

/**
 * Applies a confirmed field mapping to parsed rows and bulk-creates Invoice records.
 * Enqueues each invoice for BIR transmission after creation.
 */
export async function importInvoices(
  tenantId: string,
  body: ImportBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
): Promise<{ created: number; failed: number; invoiceIds: string[]; errors: string[] }> {
  const stored = uploadTokenStore.get(body.uploadToken);
  if (!stored || stored.tenantId !== tenantId) {
    throw Object.assign(new Error('Invalid or expired upload token'), { statusCode: 400 });
  }
  if (stored.expiresAt < Date.now()) {
    uploadTokenStore.delete(body.uploadToken);
    throw Object.assign(new Error('Upload token expired — please re-upload the file'), { statusCode: 400 });
  }

  const { rows } = stored;

  // Build a lookup map: sourceField → targetField
  const mappingMap = new Map(body.fieldMapping.map((m) => [m.sourceField, m.targetField]));

  const invoiceIds: string[] = [];
  const errors: string[] = [];
  let created = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      const mapped: Record<string, unknown> = { ...(body.defaultValues ?? {}) };
      for (const [srcField, value] of Object.entries(row)) {
        const targetField = mappingMap.get(srcField);
        if (targetField) mapped[targetField] = value;
      }

      const invoiceBody = rowToInvoiceBody(mapped);
      const invoice = await createInvoice(tenantId, invoiceBody, actorId, actorEmail, prisma);
      invoiceIds.push(invoice.id);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 2}: ${msg}`);
      failed++;
      logger.warn({ tenantId, row: i + 2, err: msg }, 'Invoice import row failed');
    }
  }

  uploadTokenStore.delete(body.uploadToken);
  logger.info({ tenantId, created, failed }, 'Bulk invoice import complete');

  return { created, failed, invoiceIds, errors };
}

/**
 * Transforms a mapped row object into a CreateInvoiceBody.
 * Field names must match BIR internal schema after mapping.
 */
function rowToInvoiceBody(mapped: Record<string, unknown>) {
  if (!mapped.buyerName) throw new Error('buyerName is required');
  if (!mapped.invoiceType) throw new Error('invoiceType is required');
  if (!mapped.invoiceDate) throw new Error('invoiceDate is required');

  return {
    invoiceType: mapped.invoiceType as 'SI' | 'OR' | 'DI' | 'CN' | 'DN',
    invoiceDate: String(mapped.invoiceDate),
    vatType: (mapped.vatType as 'VATABLE' | 'ZERO_RATED' | 'EXEMPT' | 'MIXED') ?? 'VATABLE',
    buyerTin: mapped.buyerTin ? String(mapped.buyerTin) : undefined,
    buyerName: String(mapped.buyerName),
    buyerAddress: mapped.buyerAddress ? String(mapped.buyerAddress) : undefined,
    buyerEmail: mapped.buyerEmail ? String(mapped.buyerEmail) : undefined,
    lineItems: [
      {
        lineNumber: 1,
        description: mapped.description ? String(mapped.description) : 'Item',
        unit: mapped.unit ? String(mapped.unit) : 'PC',
        quantity: Number(mapped.quantity ?? 1),
        unitPriceCentavos: Math.round(Number(mapped.unitPriceCentavos ?? mapped.amount ?? 0) * 100),
        discountCentavos: Math.round(Number(mapped.discountCentavos ?? 0) * 100),
        vatRateBps: Number(mapped.vatRateBps ?? 1200),
      },
    ],
    rawPayload: mapped,
  };
}

/**
 * Lists saved connector configurations for a tenant.
 */
export async function listConnectors(tenantId: string, prisma: PrismaClient) {
  return prisma.connectorConfig.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Creates or updates a connector configuration for a tenant.
 */
export async function saveConnector(
  tenantId: string,
  body: SaveConnectorBody,
  prisma: PrismaClient,
) {
  return prisma.connectorConfig.create({
    data: {
      tenantId,
      name: body.name,
      type: body.type,
      fieldMapping: body.fieldMapping ?? {},
      settings: body.settings ?? {},
    },
  });
}
