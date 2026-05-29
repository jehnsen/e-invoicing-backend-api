import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const lineItemSchema = z.object({
  lineNumber: z.number().int().positive(),
  itemCode: z.string().max(50).optional(),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(50),
  quantity: z.number().positive(),
  // Amounts in centavos (integer) — NEVER float
  unitPriceCentavos: z.number().int().nonnegative(),
  discountCentavos: z.number().int().nonnegative().default(0),
  vatRateBps: z.number().int().nonnegative().default(1200), // 1200 = 12.00%
});

export const createInvoiceBodySchema = z.object({
  invoiceType: z.enum(['SI', 'OR', 'DI', 'CN', 'DN']),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  vatType: z.enum(['VATABLE', 'ZERO_RATED', 'EXEMPT', 'MIXED']).default('VATABLE'),
  buyerTin: z
    .string()
    .regex(/^\d{3}-\d{3}-\d{3}-\d{3,5}$/)
    .optional(),
  buyerName: z.string().min(1).max(255),
  buyerAddress: z.string().max(500).optional(),
  buyerEmail: z.string().email().optional(),
  lineItems: z.array(lineItemSchema).min(1),
  remarks: z.string().max(1000).optional(),
  rawPayload: z.record(z.unknown()).optional(),
  // For CN/DN
  referenceInvoiceNumber: z.string().optional(),
  referenceInvoiceDate: z.string().optional(),
});

export const updateInvoiceBodySchema = createInvoiceBodySchema.partial().extend({
  status: z.enum(['DRAFT']).optional(), // can only update back to DRAFT if rejected
});

export const invoiceQuerySchema = z.object({
  status: z.enum(['DRAFT', 'QUEUED', 'SIGNING', 'TRANSMITTING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ARCHIVED']).optional(),
  invoiceType: z.enum(['SI', 'OR', 'DI', 'CN', 'DN']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
});

export const cancelInvoiceBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

export const invoiceParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceBodySchema>;
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;
export type CancelInvoiceBody = z.infer<typeof cancelInvoiceBodySchema>;
export type InvoiceParams = z.infer<typeof invoiceParamsSchema>;

export const createInvoiceJsonSchema = zodToJsonSchema(createInvoiceBodySchema);
export const updateInvoiceJsonSchema = zodToJsonSchema(updateInvoiceBodySchema);
export const cancelInvoiceJsonSchema = zodToJsonSchema(cancelInvoiceBodySchema);
