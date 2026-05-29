import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { compare } from 'bcryptjs';
import { ApiKeyScope } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      tenantId: string;
      email: string;
      role: string;
      type: 'access';
    };
    user: {
      sub: string;
      tenantId: string;
      email: string;
      role: string;
      type: 'access';
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireScope: (scope: ApiKeyScope) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(import('@fastify/jwt'), {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '15m', algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  /**
   * JWT authentication decorator — verifies Bearer token and attaches user + tenant context.
   * Multi-tenancy: tenantId from JWT is used for all downstream Prisma queries.
   */
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();

      const payload = request.user;
      if (payload.type !== 'access') {
        return reply.status(401).send({ error: 'Invalid token type' });
      }

      const tenant = await fastify.prisma.tenant.findFirst({
        where: { id: payload.tenantId, deletedAt: null },
        select: { id: true, tin: true, registeredName: true, plan: true, status: true },
      });

      if (!tenant) {
        return reply.status(401).send({ error: 'Tenant not found or inactive' });
      }

      if (tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
        return reply.status(403).send({ error: 'Tenant account is suspended or cancelled' });
      }

      request.user = {
        ...payload,
        tenant: {
          tenantId: tenant.id,
          tin: tenant.tin,
          registeredName: tenant.registeredName,
          plan: tenant.plan as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
          status: tenant.status as 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED',
        },
      } as typeof request.user;

      request.tenantId = tenant.id;
    } catch (err) {
      logger.debug({ err }, 'JWT verification failed');
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * API key authentication decorator — for machine-to-machine access.
   * Scopes are stored on request.apiKey.scopes; use requireScope() to enforce them per-route.
   */
  fastify.decorate('authenticateApiKey', async function (request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing API key' });
    }

    const rawKey = authHeader.slice(7);

    if (!rawKey.startsWith('eir_live_') && !rawKey.startsWith('eir_test_')) {
      return reply.status(401).send({ error: 'Invalid API key format' });
    }

    const activeKeys = await fastify.prisma.apiKey.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        tenant: {
          select: { id: true, tin: true, registeredName: true, plan: true, status: true },
        },
      },
    });

    let matchedKey: (typeof activeKeys)[0] | undefined;
    for (const key of activeKeys) {
      const isMatch = await compare(rawKey, key.keyHash);
      if (isMatch) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      logger.warn('API key authentication failed — no matching key found');
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    if (matchedKey.tenant.status === 'SUSPENDED' || matchedKey.tenant.status === 'CANCELLED') {
      return reply.status(403).send({ error: 'Tenant account is suspended or cancelled' });
    }

    await fastify.prisma.apiKey.update({
      where: { id: matchedKey.id },
      data: { lastUsedAt: new Date() },
    });

    request.apiKey = {
      apiKeyId: matchedKey.id,
      tenantId: matchedKey.tenantId,
      scopes: matchedKey.scopes,
      tenant: {
        tenantId: matchedKey.tenant.id,
        tin: matchedKey.tenant.tin,
        registeredName: matchedKey.tenant.registeredName,
        plan: matchedKey.tenant.plan as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
        status: matchedKey.tenant.status as 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED',
      },
    } as typeof request.apiKey;

    request.tenantId = matchedKey.tenantId;
  });

  /**
   * Returns a preHandler that enforces a required API key scope.
   * Must be used AFTER authenticateApiKey in the preHandler chain.
   *
   * Usage: preHandler: [fastify.authenticateApiKey, fastify.requireScope('INVOICE_SUBMIT')]
   */
  fastify.decorate(
    'requireScope',
    (scope: ApiKeyScope) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.apiKey) {
          return reply.status(401).send({ error: 'API key authentication required' });
        }
        if (!request.apiKey.scopes.includes(scope) && !request.apiKey.scopes.includes('ADMIN' as ApiKeyScope)) {
          logger.warn({ apiKeyId: request.apiKey.apiKeyId, requiredScope: scope, grantedScopes: request.apiKey.scopes }, 'API key missing required scope');
          return reply.status(403).send({ error: `API key missing required scope: ${scope}` });
        }
      },
  );
});

export default authPlugin;
