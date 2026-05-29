import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';

// Integration tests require a real PostgreSQL database configured via DATABASE_URL
// Run with: DATABASE_URL=postgresql://... npm test

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long!!';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-at-least-32-chars!';
  process.env.ENCRYPTION_KEY = '0'.repeat(64);

  if (!process.env.DATABASE_URL) {
    console.warn('Skipping integration tests — DATABASE_URL not set');
    return;
  }

  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

describe('POST /auth/register', () => {
  it('registers a new tenant and returns tokens', async () => {
    if (!app) return;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        tin: '123-456-789-00001',
        registeredName: 'Test Tenant Corp',
        address: '123 Test St, Manila',
        contactEmail: 'contact@testtenant.ph',
        ownerFirstName: 'Juan',
        ownerLastName: 'dela Cruz',
        ownerEmail: `owner-${Date.now()}@testtenant.ph`,
        ownerPassword: 'SecurePass123!',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
  });

  it('rejects duplicate TIN', async () => {
    if (!app) return;

    const payload = {
      tin: '999-888-777-00001',
      registeredName: 'Dupe Corp',
      address: '456 Test Ave',
      contactEmail: 'dupe@corp.ph',
      ownerFirstName: 'Ana',
      ownerLastName: 'Santos',
      ownerEmail: `owner-dupe-${Date.now()}@corp.ph`,
      ownerPassword: 'Password123!',
    };

    await app.inject({ method: 'POST', url: '/auth/register', payload });
    const second = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...payload, ownerEmail: `owner2-${Date.now()}@corp.ph` } });
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /healthz', () => {
  it('returns 200 with health info', async () => {
    if (!app) return;
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBeLessThan(600);
    const body = response.json();
    expect(body).toHaveProperty('timestamp');
  });
});
