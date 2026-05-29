import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { submitInvoice } from '../lib/bir-client';
import { formatToBirJson } from '../lib/bir-formatter';
import { signInvoicePayload } from '../lib/jws';
import { deliverWebhookEvent } from '../modules/webhooks/webhooks.service';

const MAX_MANUAL_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [5, 15, 60]; // exponential-style: 5min, 15min, 1hr

const prisma = new PrismaClient();

/**
 * Scheduled retry worker for REJECTED invoices.
 * Runs on a cron schedule (every 5 minutes).
 * Re-attempts transmission for invoices that failed due to transient BIR API errors.
 * Stops after MAX_MANUAL_RETRIES attempts to avoid infinite retries on permanent rejections.
 */
export async function retryFailedTransmissions(): Promise<void> {
  logger.info('Retry transmission job started');

  const now = new Date();

  // Find invoices that failed transmission and are eligible for retry
  const rejectedInvoices = await prisma.invoice.findMany({
    where: {
      status: 'REJECTED',
      deletedAt: null,
      // Only retry if birIref is null — means BIR never accepted it (not a valid rejection)
      birIref: null,
    },
    include: { lineItems: true, tenant: true },
    take: 50,
  });

  logger.info({ count: rejectedInvoices.length }, 'Found invoices eligible for retry');

  for (const invoice of rejectedInvoices) {
    const transmissionCount = await prisma.transmission.count({
      where: { invoiceId: invoice.id },
    });

    if (transmissionCount >= MAX_MANUAL_RETRIES) {
      logger.warn(
        { invoiceId: invoice.id, transmissionCount },
        'Invoice exceeded max retries — giving up',
      );
      continue;
    }

    const retryIndex = Math.min(transmissionCount, RETRY_BACKOFF_MINUTES.length - 1);
    const backoffMs = RETRY_BACKOFF_MINUTES[retryIndex] * 60 * 1000;
    const lastTransmission = await prisma.transmission.findFirst({
      where: { invoiceId: invoice.id },
      orderBy: { sentAt: 'desc' },
    });

    if (lastTransmission && now.getTime() - lastTransmission.sentAt.getTime() < backoffMs) {
      continue; // Too soon to retry
    }

    logger.info(
      { invoiceId: invoice.id, attempt: transmissionCount + 1 },
      'Retrying invoice transmission',
    );

    try {
      if (!invoice.tenant.birPrivateKeyArn) {
        logger.warn({ invoiceId: invoice.id }, 'No BIR key ARN — cannot retry');
        continue;
      }

      const birJson = formatToBirJson(invoice);
      const { jws } = await signInvoicePayload(
        birJson as unknown as Record<string, unknown>,
        invoice.tenant.birPrivateKeyArn,
        invoice.tenant.tin,
      );

      const birResponse = await submitInvoice(
        { invoice: birJson, jws },
        {
          tenantId: invoice.tenantId,
          invoiceId: invoice.id,
          baseUrl: invoice.tenant.birApiEndpoint ?? undefined,
        },
        prisma,
      );

      if (birResponse.status === 'ACCEPTED') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'ACCEPTED',
            birIref: birResponse.iref,
            birResponse: birResponse as unknown as object,
            birAcceptedAt: new Date(),
          },
        });

        await deliverWebhookEvent(invoice.tenantId, 'INVOICE_ACCEPTED', {
          invoiceId: invoice.id,
          birIref: birResponse.iref,
        }, prisma).catch((err) => logger.warn({ err }, 'Webhook delivery failed after retry success'));

        logger.info({ invoiceId: invoice.id, birIref: birResponse.iref }, 'Retry succeeded');
      } else {
        logger.warn({ invoiceId: invoice.id, birResponse }, 'BIR retry still rejected');
        await deliverWebhookEvent(invoice.tenantId, 'TRANSMISSION_FAILED', {
          invoiceId: invoice.id,
          attempt: transmissionCount + 1,
        }, prisma).catch((err) => logger.warn({ err }, 'Webhook delivery failed after retry rejection'));
      }
    } catch (err) {
      logger.error({ err, invoiceId: invoice.id }, 'Retry transmission error');
    }
  }

  logger.info('Retry transmission job complete');
}
