import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeys.service';
import { ApiKeyScope } from '@prisma/client';
import { assertUser } from '../../lib/request-context';

const API_KEY_SCOPES = [
  'INVOICE_READ', 'INVOICE_WRITE', 'INVOICE_SUBMIT',
  'CONNECTOR_READ', 'CONNECTOR_WRITE',
  'COMPLIANCE_READ',
  'WEBHOOK_READ', 'WEBHOOK_WRITE',
  'ADMIN',
] as const;

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  expiresAt: z.string().datetime().optional(),
  isLive: z.boolean().default(true),
});

type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;

const apiKeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post<{ Body: CreateApiKeyBody }>(
    '/api-keys',
    { schema: { body: zodToJsonSchema(createApiKeySchema) } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only OWNER or ADMIN can create API keys' });
      }

      const key = await createApiKey(
        user.tenantId,
        {
          name: request.body.name,
          scopes: request.body.scopes as ApiKeyScope[],
          expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : undefined,
          isLive: request.body.isLive,
        },
        user.sub,
        user.email,
        fastify.prisma,
      );

      return reply.status(201).send({ apiKey: key });
    },
  );

  fastify.get('/api-keys', async (request, reply) => {
    const user = assertUser(request);
    const keys = await listApiKeys(user.tenantId, fastify.prisma);
    return reply.send({ apiKeys: keys });
  });

  fastify.delete<{ Params: { id: string } }>('/api-keys/:id', async (request, reply) => {
    const user = assertUser(request);
    if (!['OWNER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only OWNER or ADMIN can revoke API keys' });
    }
    await revokeApiKey(user.tenantId, request.params.id, user.sub, user.email, fastify.prisma);
    return reply.status(204).send();
  });
};

export default apiKeysRoutes;
