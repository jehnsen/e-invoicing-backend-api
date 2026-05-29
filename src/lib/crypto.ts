import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is not configured — cannot encrypt/decrypt tenant credentials');
  }
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a base64-encoded string: IV + AuthTag + Ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64-encoded AES-256-GCM ciphertext produced by encrypt().
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Creates an HMAC-SHA256 signature for webhook payload verification.
 */
export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Generates a cryptographically random API key with the given prefix.
 * Returns both the plaintext key (shown once) and a value suitable for hashing.
 */
export function generateApiKeyParts(prefix: 'eir_live_' | 'eir_test_'): {
  plaintext: string;
  randomPart: string;
} {
  const randomPart = randomBytes(24).toString('base64url');
  return { plaintext: `${prefix}${randomPart}`, randomPart };
}
