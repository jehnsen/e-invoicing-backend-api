import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';
import { sqsClient } from '../config/aws';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { formatToBirJson } from '../lib/bir-formatter';
import { validateBirPayload } from '../lib/validator';
import { signInvoicePayload } from '../lib/jws';
import { submitInvoice } from '../lib/bir-client';
import { archiveInvoice } from '../modules/archive/archive.service';
import { deliverWebhookEvent } from '../modules/webhooks/webhooks.service';

const BATCH_SIZE = 10;
const VISIBILITY_TIMEOUT = 300; // 5 minutes per message
const MAX_RETRIES = 3;

const prisma = new PrismaClient();

interface InvoiceMessage {
  invoiceId: string;
  tenantId: string;
}

/**
 * SQS consumer for the invoice processing pipeline.
 * For each message:
 *   1. Load Invoice + line items from DB
 *   2. Validate BIR fields
 *   3. Format to BIR JSON schema
 *   4. Sign with tenant JWS (RS256)
 *   5. Transmit to BIR EIS API
 *   6. Update invoice status
 *   7. Trigger outbound webhooks
 *   8. Archive if accepted
 *
 * Idempotent: ACCEPTED invoices are skipped.
 * DLQ: messages exceeding MAX_RETRIES are sent to DLQ automatically by SQS.
 */
export async function startInvoiceProcessorWorker(): Promise<void> {
  if (!env.SQS_INVOICE_QUEUE_URL) {
    logger.warn('SQS_INVOICE_QUEUE_URL not configured — invoice processor worker will not start');
    return;
  }

  logger.info('Invoice processor worker started');

  while (true) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: env.SQS_INVOICE_QUEUE_URL,
          MaxNumberOfMessages: BATCH_SIZE,
          WaitTimeSeconds: 20,  // Long polling
          VisibilityTimeout: VISIBILITY_TIMEOUT,
          AttributeNames: ['ApproximateReceiveCount'],
        }),
      );

      if (!response.Messages || response.Messages.length === 0) continue;

      logger.debug({ count: response.Messages.length }, 'Received SQS messages');

      await Promise.allSettled(
        response.Messages.map((msg) =>
          processInvoiceMessage(
            JSON.parse(msg.Body ?? '{}') as InvoiceMessage,
            msg.ReceiptHandle!,
          ),
        ),
      );
    } catch (err) {
      logger.error({ err }, 'Invoice processor worker error — retrying in 5s');
      await sleep(5000);
    }
  }
}

async function processInvoiceMessage(
  message: InvoiceMessage,
  receiptHandle: string,
): Promise<void> {
  const { invoiceId, tenantId } = message;
  const log = logger.child({ invoiceId, tenantId });

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { lineItems: true, tenant: true },
    });

    if (!invoice) {
      log.warn('Invoice not found — discarding message');
      await deleteMessage(receiptHandle);
      return;
    }

    // Idempotency guard: skip already-processed invoices
    if (invoice.status === 'ACCEPTED') {
      log.info('Invoice already ACCEPTED — skipping');
      await deleteMessage(receiptHandle);
      return;
    }

    // SIGNING/TRANSMITTING are recoverable in-flight states from a prior crashed attempt.
    // QUEUED/REJECTED are normal entry points.
    const recoverableStatuses = ['QUEUED', 'REJECTED', 'SIGNING', 'TRANSMITTING'];
    if (!recoverableStatuses.includes(invoice.status)) {
      log.warn({ status: invoice.status }, 'Invoice in unexpected status — discarding');
      await deleteMessage(receiptHandle);
      return;
    }

    // Atomic status claim — acts as an optimistic lock so two worker instances
    // cannot both process the same invoice concurrently after a visibility timeout.
    const claimed = await prisma.invoice.updateMany({
      where: { id: invoiceId, status: { in: recoverableStatuses as never[] } },
      data: { status: 'SIGNING' },
    });
    if (claimed.count === 0) {
      log.info('Invoice already claimed by another worker — skipping');
      await deleteMessage(receiptHandle);
      return;
    }

    // 1. Format to BIR JSON
    const birJson = formatToBirJson(invoice);

    // 2. Validate
    const validation = validateBirPayload(birJson);
    if (!validation.valid) {
      log.error({ errors: validation.errors }, 'BIR validation failed');
      await markRejected(invoiceId, { validationErrors: validation.errors }, null);
      await deleteMessage(receiptHandle);
      return;
    }

    // 3. Sign with JWS — re-use existing token if a prior attempt already signed it
    if (!invoice.tenant.birPrivateKeyArn) {
      log.error('Tenant has no BIR private key ARN configured');
      await markRejected(invoiceId, { error: 'No BIR private key configured' }, null);
      await deleteMessage(receiptHandle);
      return;
    }

    let jws: string;
    if (invoice.jwsToken && invoice.status === 'TRANSMITTING') {
      // Recovering from a crash after signing but before transmit — re-use the token
      jws = invoice.jwsToken;
      log.info('Re-using existing JWS token from previous attempt');
    } else {
      ({ jws } = await signInvoicePayload(
        birJson as unknown as Record<string, unknown>,
        invoice.tenant.birPrivateKeyArn,
        invoice.tenant.tin,
      ));
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { jwsToken: jws, birJson, status: 'TRANSMITTING' },
    });

    // 4. Transmit to BIR
    const birResponse = await submitInvoice(
      { invoice: birJson, jws },
      { tenantId, invoiceId, baseUrl: invoice.tenant.birApiEndpoint ?? undefined },
      prisma,
    );

    if (birResponse.status === 'ACCEPTED') {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'ACCEPTED',
          birIref: birResponse.iref,
          birResponse: birResponse as unknown as object,
          birAcceptedAt: new Date(),
          processedAt: new Date(),
        },
      });

      log.info({ birIref: birResponse.iref }, 'Invoice accepted by BIR');

      // 5. Trigger webhook
      await deliverWebhookEvent(tenantId, 'INVOICE_ACCEPTED', { invoiceId, birIref: birResponse.iref }, prisma);

      // 6. Enqueue for archive
      await archiveInvoice(tenantId, invoiceId, prisma);
    } else {
      await markRejected(invoiceId, birResponse as unknown as Record<string, unknown>, null);
      await deliverWebhookEvent(tenantId, 'INVOICE_REJECTED', { invoiceId, birResponse }, prisma);
    }

    await deleteMessage(receiptHandle);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error({ err: error }, 'Failed to process invoice message');

    // Let SQS retry — visibility timeout will expire and message becomes visible again
    // SQS DLQ handles final failure after maxReceiveCount is exceeded
    await deliverWebhookEvent(tenantId, 'TRANSMISSION_FAILED', { invoiceId, error: error.message }, prisma).catch(
      () => undefined,
    );
  }
}

async function markRejected(
  invoiceId: string,
  birResponse: Record<string, unknown> | null,
  birIref: string | null,
) {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'REJECTED',
      birIref: birIref ?? undefined,
      birResponse: birResponse as object ?? undefined,
    },
  });
}

async function deleteMessage(receiptHandle: string) {
  if (!env.SQS_INVOICE_QUEUE_URL) return;
  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: env.SQS_INVOICE_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
