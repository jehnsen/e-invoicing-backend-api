import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const updateTenantBodySchema = z.object({
  registeredName: z.string().min(1).max(255).optional(),
  tradeName: z.string().max(255).optional(),
  address: z.string().max(500).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
  birApiEndpoint: z.string().url().optional(),
  plan: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED']).optional(),
  // BIR credentials are stored encrypted — provide as plaintext, encrypted server-side
  birCredentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  birPrivateKeyArn: z.string().optional(),
  birCertificateArn: z.string().optional(),
});

export const tenantParamsSchema = z.object({
  id: z.string().uuid(),
});

export type UpdateTenantBody = z.infer<typeof updateTenantBodySchema>;
export type TenantParams = z.infer<typeof tenantParamsSchema>;

export const updateTenantJsonSchema = zodToJsonSchema(updateTenantBodySchema);
export const tenantParamsJsonSchema = zodToJsonSchema(tenantParamsSchema);
