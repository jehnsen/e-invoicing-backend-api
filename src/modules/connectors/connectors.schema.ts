import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const saveConnectorSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['EXCEL', 'CSV', 'JSON', 'QUICKBOOKS', 'SAP', 'POSTGRES', 'REST_WEBHOOK']),
  fieldMapping: z.record(z.string()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const importBodySchema = z.object({
  uploadToken: z.string().min(1),   // token from /connectors/upload response
  mappingTemplateId: z.string().uuid().optional(),
  fieldMapping: z.array(
    z.object({
      sourceField: z.string(),
      targetField: z.string(),
    }),
  ),
  defaultValues: z.record(z.unknown()).optional(),
});

export type SaveConnectorBody = z.infer<typeof saveConnectorSchema>;
export type ImportBody = z.infer<typeof importBodySchema>;

export const saveConnectorJsonSchema = zodToJsonSchema(saveConnectorSchema);
export const importBodyJsonSchema = zodToJsonSchema(importBodySchema);
