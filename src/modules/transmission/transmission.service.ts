import { PrismaClient } from '@prisma/client';
import { TransmissionQuery } from './transmission.schema';

/**
 * Lists transmission attempts for a tenant, optionally filtered by invoice.
 * Multi-tenancy: all queries scoped to tenantId.
 */
export async function listTransmissions(
  tenantId: string,
  query: TransmissionQuery,
  prisma: PrismaClient,
) {
  const where: Parameters<PrismaClient['transmission']['findMany']>[0]['where'] = {
    tenantId,  // Multi-tenancy: ALWAYS scope to tenant
  };

  if (query.invoiceId) where.invoiceId = query.invoiceId;
  if (query.cursor) where.id = { lt: query.cursor };

  const limit = query.limit ?? 20;
  const items = await prisma.transmission.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    items: page,
    nextCursor: hasMore ? page[page.length - 1].id : undefined,
  };
}
