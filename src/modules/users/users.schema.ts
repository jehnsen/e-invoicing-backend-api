import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const USER_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;
const ASSIGNABLE_ROLES = ['ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const createUserBodySchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(ASSIGNABLE_ROLES).default('ACCOUNTANT'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateUserBodySchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type UserParams = z.infer<typeof userParamsSchema>;

export const listUsersJsonSchema = zodToJsonSchema(listUsersQuerySchema);
export const createUserJsonSchema = zodToJsonSchema(createUserBodySchema);
export const updateUserJsonSchema = zodToJsonSchema(updateUserBodySchema);
export const changePasswordJsonSchema = zodToJsonSchema(changePasswordBodySchema);
export const userParamsJsonSchema = zodToJsonSchema(userParamsSchema);
