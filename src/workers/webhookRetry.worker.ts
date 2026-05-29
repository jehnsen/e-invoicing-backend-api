import { PrismaClient } from '@prisma/client';
import { signWebhookPayload } from '../lib/crypto';
import { logger } from '../lib/logger';

const MAX_WEBHOOK_ATTEMPTS = 5;
// Backoff per attempt index: 1min, 5min, 30min, 2hr, 8hr
const BACKOFF_MINUTES = [1, 5, 30, 120, 480];

const prisma = new PrismaClient();

/**
 * Retries failed webhook deliveries with exponential backoff.
 * Picks up records with success=false whose nextRetryAt has elapsed (or is null, meaning
 * they were never retried after the initial delivery attempt).
 * Runs as a cron job — every minute in app.ts.
 */
export async function retryFailedWebhooks(): Promise<void> {
  const now = new Date();

  const failed = await prisma.webhookDelivery.findMany({
    where: {
      success: false,
      attemptCount: { lt: MAX_WEBHOOK_ATTEMPTS },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      endpoint: { isActive: true, deletedAt: null },
    },
    include: { endpoint: true },
    take: 50,
  });

  if (failed.length === 0) return;

  logger.info({ count: failed.length }, 'Retrying failed webhook deliveries');

  for (const delivery of failed) {
    const endpoint = delivery.endpoint;
    const payloadStr = JSON.stringify(delivery.payload);
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
          'X-EIS-Event': delivery.event,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(10_000),
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => undefined);
      success = response.ok;
    } catch (err) {
      logger.warn({ err, deliveryId: delivery.id, endpointId: endpoint.id }, 'Webhook retry failed');
    }

    const nextAttempt = delivery.attemptCount + 1;
    const backoffIndex = Math.min(delivery.attemptCount, BACKOFF_MINUTES.length - 1);
    const nextRetryAt =
      success || nextAttempt >= MAX_WEBHOOK_ATTEMPTS
        ? null
        : new Date(Date.now() + BACKOFF_MINUTES[backoffIndex] * 60 * 1000);

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        success,
        statusCode,
        responseBody,
        attemptCount: nextAttempt,
        ...(success ? { deliveredAt: new Date() } : {}),
        nextRetryAt,
      },
    });

    if (success) {
      logger.info({ deliveryId: delivery.id, endpointId: endpoint.id }, 'Webhook retry succeeded');
    }
  }
}
