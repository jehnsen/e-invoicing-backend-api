import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';
import { sqsClient } from '../config/aws';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { archiveInvoice } from '../modules/archive/archive.service';

const BATCH_SIZE = 10;

const prisma = new PrismaClient();

interface ArchiveMessage {
  invoiceId: string;
  tenantId: string;
}

/**
 * SQS consumer for archiving accepted invoices to S3 / Glacier.
 * Processes messages from SQS_ARCHIVE_QUEUE_URL.
 * S3 lifecycle handles Glacier transition after 90 days automatically.
 */
export async function startArchiverWorker(): Promise<void> {
  const queueUrl = env.SQS_ARCHIVE_QUEUE_URL;
  if (!queueUrl) {
    logger.warn('SQS_ARCHIVE_QUEUE_URL not configured — archiver worker will not start');
    return;
  }

  logger.info('Archiver worker started');

  while (true) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: BATCH_SIZE,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 120,
        }),
      );

      if (!response.Messages || response.Messages.length === 0) continue;

      await Promise.allSettled(
        response.Messages.map(async (msg) => {
          const { invoiceId, tenantId } = JSON.parse(msg.Body ?? '{}') as ArchiveMessage;

          try {
            await archiveInvoice(tenantId, invoiceId, prisma);
            logger.info({ invoiceId, tenantId }, 'Invoice archived successfully');
          } catch (err) {
            logger.error({ err, invoiceId, tenantId }, 'Archive failed');
            return; // Let SQS retry
          }

          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: msg.ReceiptHandle!,
            }),
          );
        }),
      );
    } catch (err) {
      logger.error({ err }, 'Archiver worker error — retrying in 5s');
      await sleep(5000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
