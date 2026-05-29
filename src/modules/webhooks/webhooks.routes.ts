import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createWebhook, listWebhooks, deleteWebhook, getWebhookDeliveries } from './webhooks.service';
import { WebhookEvent } from '@prisma/client';
import { assertUser } from '../../lib/request-context';

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(
    z.enum([
      'INVOICE_CREATED', 'INVOICE_QUEUED', 'INVOICE_ACCEPTED',
      'INVOICE_REJECTED', 'INVOICE_CANCELLED', 'INVOICE_ARCHIVED', 'TRANSMISSION_FAILED',
    ] as [WebhookEvent, ...WebhookEvent[]]),
  ).min(1),
  description: z.string().max(200).optional(),
});

type CreateWebhookBody = z.infer<typeof createWebhookSchema>;

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post<{ Body: CreateWebhookBody }>(
    '/webhooks',
    { schema: { body: zodToJsonSchema(createWebhookSchema) } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
      const webhook = await createWebhook(user.tenantId, request.body, fastify.prisma);
      return reply.status(201).send({ webhook });
    },
  );

  fastify.get('/webhooks', async (request, reply) => {
    const user = assertUser(request);
    const webhooks = await listWebhooks(user.tenantId, fastify.prisma);
    return reply.send({ webhooks });
  });

  fastify.delete<{ Params: { id: string } }>('/webhooks/:id', async (request, reply) => {
    const user = assertUser(request);
    if (!['OWNER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
    await deleteWebhook(user.tenantId, request.params.id, fastify.prisma);
    return reply.status(204).send();
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { cursor?: string; limit?: string };
  }>('/webhooks/:id/deliveries', async (request, reply) => {
    const user = assertUser(request);
    const result = await getWebhookDeliveries(
      user.tenantId,
      request.params.id,
      {
        cursor: request.query.cursor,
        limit: request.query.limit ? parseInt(request.query.limit) : 20,
      },
      fastify.prisma,
    );
    return reply.send(result);
  });
};

export default webhooksRoutes;
