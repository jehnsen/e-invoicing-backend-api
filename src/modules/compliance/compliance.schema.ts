import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const auditLogQuerySchema = z.object({
  resourceType: z
    .enum(['Invoice', 'Tenant', 'ApiKey', 'ConnectorConfig', 'ArchiveRecord', 'WebhookEndpoint'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogQueryJsonSchema = zodToJsonSchema(auditLogQuerySchema);
