import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine(
      (s) => new Set(s).size >= 12,
      'JWT_SECRET has insufficient entropy — generate one with: openssl rand -base64 48',
    ),
  JWT_REFRESH_SECRET: z.string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
    .refine(
      (s) => new Set(s).size >= 12,
      'JWT_REFRESH_SECRET has insufficient entropy — generate one with: openssl rand -base64 48',
    ),

  AWS_REGION: z.string().default('ap-southeast-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  SQS_INVOICE_QUEUE_URL: z.string().url().optional(),
  SQS_ARCHIVE_QUEUE_URL: z.string().url().optional(),
  SQS_DLQ_URL: z.string().url().optional(),

  S3_BUCKET: z.string().optional(),
  GLACIER_VAULT: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),

  // TODO: confirm with BIR — update production URL when BIR publishes official EIS endpoint
  BIR_API_BASE_URL: z.string().url().default('https://sandbox.bir.gov.ph/eis'),
  BIR_API_KEY: z.string().optional(),

  SECRETS_MANAGER_KEY_ARN: z.string().optional(),

  // AES-256 hex key (64 hex chars = 32 bytes)
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)').optional(),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),

  // Comma-separated allowed CORS origins, e.g. "https://app.eis-ready.ph,https://partner.ph"
  // Omit or leave empty to allow all origins in development, block all in production.
  CORS_ORIGINS: z.string().optional(),

  SUPERADMIN_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }
  return result.data;
}

export const env = parseEnv();
