import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const registerBodySchema = z.object({
  tin: z.string().regex(/^\d{3}-\d{3}-\d{3}-\d{3,5}$/, 'Invalid TIN format'),
  registeredName: z.string().min(1).max(255),
  tradeName: z.string().max(255).optional(),
  address: z.string().min(1).max(500),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(20).optional(),
  ownerFirstName: z.string().min(1).max(100),
  ownerLastName: z.string().min(1).max(100),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const registerJsonSchema = zodToJsonSchema(registerBodySchema);
export const loginJsonSchema = zodToJsonSchema(loginBodySchema);
export const refreshJsonSchema = zodToJsonSchema(refreshBodySchema);
