import pino from 'pino';
import { env } from '../config/env';

/**
 * Sensitive fields that must never appear in logs — [REDACTED] is substituted.
 * This protects tenant BIR private keys and credentials at rest.
 */
const REDACTED_FIELDS = [
  'password',
  'passwordHash',
  'privateKey',
  'bir_private_key',
  'birPrivateKey',
  'birPrivateKeyArn',
  'birCredentials',
  'birCredentialsEncrypted',
  'apiKey',
  'keyHash',
  'secret',
  'jwtSecret',
  'refreshToken',
  'tokenHash',
  'encryptionKey',
  'authorization',
  'openaiKey',
  'openai_api_key',
  'OPENAI_API_KEY',
];

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: REDACTED_FIELDS,
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  base: {
    env: env.NODE_ENV,
    service: 'eis-ready-backend',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});
