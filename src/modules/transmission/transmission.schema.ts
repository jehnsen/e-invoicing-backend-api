import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const transmissionQuerySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type TransmissionQuery = z.infer<typeof transmissionQuerySchema>;

export const transmissionQueryJsonSchema = zodToJsonSchema(transmissionQuerySchema);
