import { PrismaClient, ApiKeyScope } from '@prisma/client';
import { hash } from 'bcryptjs';
import { generateApiKeyParts } from '../../lib/crypto';
import { logger } from '../../lib/logger';

const BCRYPT_ROUNDS = 10;

interface CreateApiKeyBody {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: Date;
  isLive?: boolean;
}

/**
 * Generates a new API key for a tenant.
 * Returns the plaintext key exactly once — only the bcrypt hash is stored.
 */
export async function createApiKey(
  tenantId: string,
  body: CreateApiKeyBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
): Promise<{ id: string; name: string; plaintextKey: string; scopes: ApiKeyScope[]; createdAt: Date }> {
  const prefix = body.isLive !== false ? 'eir_live_' : 'eir_test_';
  const { plaintext } = generateApiKeyParts(prefix);

  const keyHash = await hash(plaintext, BCRYPT_ROUNDS);

  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId,
      name: body.name,
      keyHash,
      keyPrefix: prefix,
      scopes: body.scopes,
      expiresAt: body.expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'CREATE',
      resourceType: 'ApiKey',
      resourceId: apiKey.id,
      diff: { name: body.name, scopes: body.scopes },
    },
  });

  logger.info({ tenantId, apiKeyId: apiKey.id, name: body.name }, 'API key created');

  return {
    id: apiKey.id,
    name: apiKey.name,
    plaintextKey: plaintext,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt,
  };
}

/**
 * Lists all API keys for a tenant — plaintext is never returned after creation.
 */
export async function listApiKeys(tenantId: string, prisma: PrismaClient) {
  return prisma.apiKey.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      isActive: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      // keyHash intentionally omitted
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Revokes an API key (soft disable, not delete — preserves audit trail).
 */
export async function revokeApiKey(
  tenantId: string,
  apiKeyId: string,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const key = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, tenantId },
  });

  if (!key) throw Object.assign(new Error('API key not found'), { statusCode: 404 });

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'DELETE',
      resourceType: 'ApiKey',
      resourceId: apiKeyId,
      diff: { name: key.name, revoked: true },
    },
  });

  logger.info({ tenantId, apiKeyId }, 'API key revoked');
}
