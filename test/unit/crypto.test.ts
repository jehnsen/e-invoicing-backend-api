import { describe, it, expect, beforeAll } from 'vitest';

// Set up required env vars before importing crypto module
beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
});

describe('crypto', () => {
  it('encrypts and decrypts a string correctly', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    const plaintext = 'my-secret-bir-credential';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', async () => {
    const { encrypt } = await import('../../src/lib/crypto');
    const a = encrypt('test');
    const b = encrypt('test');
    expect(a).not.toBe(b);
  });

  it('signs webhook payload deterministically', async () => {
    const { signWebhookPayload } = await import('../../src/lib/crypto');
    const sig1 = signWebhookPayload('{"event":"test"}', 'my-secret');
    const sig2 = signWebhookPayload('{"event":"test"}', 'my-secret');
    expect(sig1).toBe(sig2);
  });

  it('generates API key with correct prefix', async () => {
    const { generateApiKeyParts } = await import('../../src/lib/crypto');
    const { plaintext } = generateApiKeyParts('eir_live_');
    expect(plaintext.startsWith('eir_live_')).toBe(true);
    expect(plaintext.length).toBeGreaterThan(20);
  });
});
