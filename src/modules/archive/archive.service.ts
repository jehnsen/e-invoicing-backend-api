import {
  PutObjectCommand,
  GetObjectCommand,
  RestoreObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../../config/aws';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { PrismaClient } from '@prisma/client';

/**
 * Archives an accepted invoice: uploads BIR JSON + JWS to S3.
 * S3 lifecycle rule handles transition to Glacier after 90 days.
 * Retention: 10 years from invoice date per BIR requirement.
 *
 * S3 path: {tenantId}/{year}/{month}/{invoiceId}.json
 */
export async function archiveInvoice(
  tenantId: string,
  invoiceId: string,
  prisma: PrismaClient,
): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { lineItems: true },
  });

  if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  if (invoice.status !== 'ACCEPTED') {
    throw Object.assign(new Error('Only ACCEPTED invoices can be archived'), { statusCode: 422 });
  }

  const bucket = env.S3_BUCKET;
  if (!bucket) {
    logger.warn({ invoiceId }, 'S3_BUCKET not configured — skipping archive');
    return;
  }

  const year = invoice.invoiceDate.getFullYear();
  const month = String(invoice.invoiceDate.getMonth() + 1).padStart(2, '0');
  const s3Key = `${tenantId}/${year}/${month}/${invoiceId}.json`;

  const archivePayload = {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType,
      invoiceDate: invoice.invoiceDate.toISOString(),
      birIref: invoice.birIref,
      birJson: invoice.birJson,
      jwsToken: invoice.jwsToken,
      totalAmountCentavos: invoice.totalAmountCentavos.toString(),
    },
    archivedAt: new Date().toISOString(),
  };

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: JSON.stringify(archivePayload),
      ContentType: 'application/json',
      Metadata: {
        tenantId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        birIref: invoice.birIref ?? '',
      },
    }),
  );

  // Retention: 10 years from invoice date
  const retentionUntil = new Date(invoice.invoiceDate);
  retentionUntil.setFullYear(retentionUntil.getFullYear() + 10);

  await prisma.$transaction(async (tx) => {
    await tx.archiveRecord.upsert({
      where: { invoiceId },
      create: {
        invoiceId,
        tenantId,
        s3Key,
        s3Bucket: bucket,
        retentionUntil,
      },
      update: {
        s3Key,
        s3Bucket: bucket,
        retentionUntil,
        updatedAt: new Date(),
      },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action: 'ARCHIVE',
        resourceType: 'Invoice',
        resourceId: invoiceId,
        diff: { s3Key, retentionUntil: retentionUntil.toISOString() },
      },
    });
  });

  logger.info({ tenantId, invoiceId, s3Key }, 'Invoice archived to S3');
}

/**
 * Retrieves the archive record for an invoice and generates a presigned S3 URL.
 * If the object has been transitioned to Glacier, initiates a restore request.
 */
export async function getArchiveRecord(
  tenantId: string,
  invoiceId: string,
  prisma: PrismaClient,
): Promise<{ s3Key: string; presignedUrl?: string; glacierRestoreStatus?: string; retentionUntil: Date }> {
  const record = await prisma.archiveRecord.findFirst({
    where: { invoiceId, tenantId },
  });

  if (!record) {
    throw Object.assign(new Error('Archive record not found for this invoice'), { statusCode: 404 });
  }

  if (!env.S3_BUCKET) {
    return { s3Key: record.s3Key, retentionUntil: record.retentionUntil };
  }

  // Check if object is in Glacier
  let glacierRestoreStatus: string | undefined;
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({ Bucket: record.s3Bucket, Key: record.s3Key }),
    );

    if (head.Restore) {
      // Object is being restored from Glacier
      glacierRestoreStatus = head.Restore;

      if (!head.Restore.includes('ongoing-request="false"')) {
        // Restore still in progress
        return { s3Key: record.s3Key, glacierRestoreStatus, retentionUntil: record.retentionUntil };
      }
    }
  } catch (err) {
    logger.warn({ err, s3Key: record.s3Key }, 'S3 HeadObject failed — may be in Glacier');

    // Initiate Glacier restore (1-5 hour turnaround for Standard)
    try {
      await s3Client.send(
        new RestoreObjectCommand({
          Bucket: record.s3Bucket,
          Key: record.s3Key,
          RestoreRequest: { Days: 7, GlacierJobParameters: { Tier: 'Standard' } },
        }),
      );
      glacierRestoreStatus = 'restore-initiated';
    } catch (restoreErr) {
      logger.warn({ restoreErr }, 'Glacier restore initiation failed');
    }

    return {
      s3Key: record.s3Key,
      glacierRestoreStatus: glacierRestoreStatus ?? 'in-glacier',
      retentionUntil: record.retentionUntil,
    };
  }

  const presignedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: record.s3Bucket, Key: record.s3Key }),
    { expiresIn: 3600 }, // 1 hour
  );

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorType: 'USER',
      action: 'RETRIEVE',
      resourceType: 'ArchiveRecord',
      resourceId: record.id,
      diff: { invoiceId },
    },
  });

  return { s3Key: record.s3Key, presignedUrl, retentionUntil: record.retentionUntil };
}
