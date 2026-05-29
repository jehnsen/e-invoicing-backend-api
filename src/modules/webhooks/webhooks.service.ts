import { PrismaClient, WebhookEvent } from '@prisma/client';
import { randomBytes } from 'crypto';
import { signWebhookPayload } from '../../lib/crypto';
import { logger } from '../../lib/logger';

interface CreateWebhookBody {
  url: string;
  events: WebhookEvent[];
  description?: string;
}

/**
 * Registers a new outbound webhook endpoint for a tenant.
 * Generates an HMAC signing secret — return it to the caller once.
 */
export async function createWebhook(
  tenantId: string,
  body: CreateWebhookBody,
  prisma: PrismaClient,
) {
  const secret = randomBytes(32).toString('base64url');

  const webhook = await prisma.webhookEndpoint.create({
    data: {
      tenantId,
      url: body.url,
      events: body.events,
      description: body.description,
      secret,
    },
  });

  return { ...webhook, secret }; // Return secret only on creation
}

/**
 * Lists all webhook endpoints for a tenant (secret is never returned after creation).
 */
export async function listWebhooks(tenantId: string, prisma: PrismaClient) {
  return prisma.webhookEndpoint.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      url: true,
      events: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      // secret intentionally omitted
    },
  });
}

/**
 * Soft-deletes a webhook endpoint.
 */
export async function deleteWebhook(
  tenantId: string,
  webhookId: string,
  prisma: PrismaClient,
) {
  const webhook = await prisma.webhookEndpoint.findFirst({
    where: { id: webhookId, tenantId, deletedAt: null },
  });

  if (!webhook) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });

  await prisma.webhookEndpoint.update({
    where: { id: webhookId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Returns delivery history for a webhook endpoint.
 */
export async function getWebhookDeliveries(
  tenantId: string,
  webhookId: string,
  params: { cursor?: string; limit?: number },
  prisma: PrismaClient,
) {
  // Verify ownership
  const webhook = await prisma.webhookEndpoint.findFirst({
    where: { id: webhookId, tenantId },
  });

  if (!webhook) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });

  const where: Parameters<PrismaClient['webhookDelivery']['findMany']>[0]['where'] = {
    endpointId: webhookId,
  };
  if (params.cursor) where.id = { lt: params.cursor };

  const limit = params.limit ?? 20;
  const items = await prisma.webhookDelivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    items: page,
    nextCursor: hasMore ? page[page.length - 1].id : undefined,
  };
}

/**
 * Delivers a webhook event to all registered endpoints for a tenant.
 * Signs payload with HMAC-SHA256 using the endpoint's secret.
 * Records every delivery attempt in WebhookDelivery table.
 */
export async function deliverWebhookEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  prisma: PrismaClient,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      tenantId,
      isActive: true,
      deletedAt: null,
      events: { has: event },
    },
  });

  if (endpoints.length === 0) return;

  const payloadStr = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  const deliveryPromises = endpoints.map(async (endpoint) => {
    const signature = signWebhookPayload(payloadStr, endpoint.secret);

    let statusCode: number | undefined;
    let responseBody: string | undefined;
    let success = false;

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EIS-Signature': `sha256=${signature}`,
          'X-EIS-Event': event,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(10_000),
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => undefined);
      success = response.ok;
    } catch (err) {
      logger.warn({ err, endpointId: endpoint.id, event }, 'Webhook delivery failed');
    }

    await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: JSON.parse(payloadStr) as object,
        statusCode,
        responseBody,
        success,
        deliveredAt: success ? new Date() : undefined,
      },
    });
  });

  await Promise.allSettled(deliveryPromises);
}
