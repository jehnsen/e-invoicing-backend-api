import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const suggestMappingBodySchema = z.object({
  sampleRows: z.array(z.record(z.unknown())).min(1).max(10),
  sourceHeaders: z.array(z.string()).min(1),
  connectorType: z.enum(['EXCEL', 'CSV', 'JSON', 'QUICKBOOKS', 'SAP', 'POSTGRES', 'REST_WEBHOOK']).optional(),
});

export const saveMappingTemplateBodySchema = z.object({
  name: z.string().min(1).max(100),
  sourceType: z.enum(['EXCEL', 'CSV', 'JSON', 'QUICKBOOKS', 'SAP', 'POSTGRES', 'REST_WEBHOOK']),
  mapping: z.array(
    z.object({
      sourceField: z.string(),
      targetField: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  isAiGenerated: z.boolean().default(false),
});

export const templateParamsSchema = z.object({
  id: z.string().uuid(),
});

export type SuggestMappingBody = z.infer<typeof suggestMappingBodySchema>;
export type SaveMappingTemplateBody = z.infer<typeof saveMappingTemplateBodySchema>;
export type TemplateParams = z.infer<typeof templateParamsSchema>;

export const suggestMappingJsonSchema = zodToJsonSchema(suggestMappingBodySchema);
export const saveMappingTemplateJsonSchema = zodToJsonSchema(saveMappingTemplateBodySchema);
