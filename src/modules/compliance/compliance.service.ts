import { PrismaClient } from '@prisma/client';
import { pingBirApi } from '../../lib/bir-client';
import { env } from '../../config/env';
import { PaginationParams, PaginatedResult } from '../../types/tenant.types';

/**
 * Returns compliance dashboard summary metrics for a tenant.
 * Includes invoice status counts, transmission success rate, and VAT totals.
 * Multi-tenancy: all queries scoped to tenantId.
 */
export async function getComplianceSummary(tenantId: string, prisma: PrismaClient) {
  const [statusCounts, transmissionStats, vatTotals, recentRejections] = await Promise.all([
    // Invoice counts by status
    prisma.invoice.groupBy({
      by: ['status'],
      where: { tenantId, deletedAt: null },
      _count: { id: true },
    }),

    // Transmission success rate (last 30 days)
    prisma.transmission.aggregate({
      where: {
        tenantId,
        sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _count: { id: true },
      _avg: { durationMs: true },
    }),

    // VAT totals for accepted invoices this calendar year
    prisma.invoice.aggregate({
      where: {
        tenantId,
        status: 'ACCEPTED',
        invoiceDate: {
          gte: new Date(new Date().getFullYear(), 0, 1),
        },
      },
      _sum: { vatAmountCentavos: true, totalAmountCentavos: true },
      _count: { id: true },
    }),

    // Recent rejections
    prisma.invoice.findMany({
      where: { tenantId, status: 'REJECTED', deletedAt: null },
      select: {
        id: true, invoiceNumber: true, birResponse: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
  ]);

  const transmissionSuccess = await prisma.transmission.count({
    where: {
      tenantId,
      success: true,
      sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  const totalTransmissions = transmissionStats._count.id;
  const successRate = totalTransmissions > 0 ? transmissionSuccess / totalTransmissions : 0;

  const statusMap = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count.id]),
  );

  return {
    invoiceCounts: statusMap,
    transmissions: {
      total30d: totalTransmissions,
      successRate: Math.round(successRate * 10000) / 100, // percentage with 2 decimals
      avgDurationMs: Math.round(transmissionStats._avg.durationMs ?? 0),
    },
    yearToDate: {
      acceptedCount: vatTotals._count.id,
      totalVatPhp: centavosToPhp(vatTotals._sum.vatAmountCentavos ?? BigInt(0)),
      totalAmountPhp: centavosToPhp(vatTotals._sum.totalAmountCentavos ?? BigInt(0)),
    },
    recentRejections,
  };
}

/**
 * Returns paginated audit log entries for a tenant.
 */
export async function getAuditLog(
  tenantId: string,
  params: PaginationParams & { resourceType?: string; limit?: number },
  prisma: PrismaClient,
): Promise<PaginatedResult<unknown>> {
  const where: NonNullable<Parameters<PrismaClient['auditLog']['findMany']>[0]>['where'] = {
    tenantId,  // Multi-tenancy: ALWAYS scope to tenant
  };

  if (params.resourceType) where.resourceType = params.resourceType;
  if (params.cursor) where.id = { lt: params.cursor };

  const limit = Math.min(params.limit ?? 20, 100);
  const items = await prisma.auditLog.findMany({
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
 * Checks BIR API connectivity and returns health status.
 */
export async function getBirStatus() {
  const result = await pingBirApi();
  return {
    birApi: {
      reachable: result.reachable,
      latencyMs: result.latencyMs,
      // TODO: confirm with BIR — add actual BIR status endpoint when available
      endpoint: env.BIR_API_BASE_URL,
    },
    checkedAt: new Date().toISOString(),
  };
}

function centavosToPhp(centavos: bigint): string {
  const abs = centavos < BigInt(0) ? -centavos : centavos;
  const sign = centavos < BigInt(0) ? '-' : '';
  return `${sign}${(abs / BigInt(100))}.${(abs % BigInt(100)).toString().padStart(2, '0')}`;
}
