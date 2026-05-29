import { PrismaClient } from '@prisma/client';
import { encrypt } from '../../lib/crypto';
import { UpdateTenantBody } from './tenants.schema';
import { logger } from '../../lib/logger';

/**
 * Lists tenants with cursor-based pagination (superadmin only — checked in route handler).
 */
export async function listTenants(
  prisma: PrismaClient,
  params: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(params.limit ?? 20, 100);
  const where: Parameters<PrismaClient['tenant']['findMany']>[0]['where'] = { deletedAt: null };
  if (params.cursor) where.id = { lt: params.cursor };

  const items = await prisma.tenant.findMany({
    where,
    select: {
      id: true,
      tin: true,
      registeredName: true,
      tradeName: true,
      contactEmail: true,
      plan: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : undefined };
}

/**
 * Retrieves a single tenant by ID.
 * Multi-tenancy: callers must ensure they only request their own tenantId unless superadmin.
 */
export async function getTenantById(tenantId: string, prisma: PrismaClient) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      id: true,
      tin: true,
      registeredName: true,
      tradeName: true,
      address: true,
      contactEmail: true,
      contactPhone: true,
      plan: true,
      status: true,
      birApiEndpoint: true,
      invoicePrefix: true,
      createdAt: true,
      updatedAt: true,
      // NEVER return birCredentialsEncrypted or key ARNs to clients
    },
  });

  if (!tenant) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }

  return tenant;
}

/**
 * Updates tenant settings including BIR credentials (encrypted before storage).
 * BIR credentials are encrypted with AES-256-GCM before writing to DB.
 */
export async function updateTenant(
  tenantId: string,
  body: UpdateTenantBody,
  actorId: string,
  actorEmail: string,
  prisma: PrismaClient,
) {
  const existing = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!existing) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }

  const updateData: Parameters<PrismaClient['tenant']['update']>[0]['data'] = {};

  if (body.registeredName !== undefined) updateData.registeredName = body.registeredName;
  if (body.tradeName !== undefined) updateData.tradeName = body.tradeName;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.contactEmail !== undefined) updateData.contactEmail = body.contactEmail;
  if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone;
  if (body.birApiEndpoint !== undefined) updateData.birApiEndpoint = body.birApiEndpoint;
  if (body.plan !== undefined) updateData.plan = body.plan;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.birPrivateKeyArn !== undefined) updateData.birPrivateKeyArn = body.birPrivateKeyArn;
  if (body.birCertificateArn !== undefined) updateData.birCertificateArn = body.birCertificateArn;

  if (body.birCredentials) {
    // Encrypt BIR credentials before storing — NEVER store plaintext
    updateData.birCredentialsEncrypted = encrypt(JSON.stringify(body.birCredentials));
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
    select: {
      id: true,
      tin: true,
      registeredName: true,
      tradeName: true,
      address: true,
      contactEmail: true,
      plan: true,
      status: true,
      updatedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'UPDATE',
      resourceType: 'Tenant',
      resourceId: tenantId,
      diff: { updated: Object.keys(updateData) },
    },
  });

  logger.info({ tenantId, updatedFields: Object.keys(updateData) }, 'Tenant updated');

  return updated;
}
