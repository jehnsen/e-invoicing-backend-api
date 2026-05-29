import { FastifyPluginAsync } from 'fastify';
import { updateTenantJsonSchema, UpdateTenantBody, TenantParams } from './tenants.schema';
import { listTenants, getTenantById, updateTenant } from './tenants.service';
import { env } from '../../config/env';
import { assertUser } from '../../lib/request-context';

const tenantsRoutes: FastifyPluginAsync = async (fastify) => {
  // All tenant routes require JWT authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // List all tenants — superadmin only
  fastify.get<{ Querystring: { cursor?: string; limit?: string } }>('/tenants', async (request, reply) => {
    const user = assertUser(request);
    if (user.email !== env.SUPERADMIN_EMAIL) {
      return reply.status(403).send({ error: 'Superadmin access required' });
    }
    const result = await listTenants(fastify.prisma, {
      cursor: request.query.cursor,
      limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
    });
    return reply.send(result);
  });

  // Get own tenant (or any tenant for superadmin)
  fastify.get<{ Params: TenantParams }>('/tenants/:id', async (request, reply) => {
    const user = assertUser(request);
    const targetId = request.params.id;

    // Multi-tenancy: non-superadmin users can only view their own tenant
    if (user.email !== env.SUPERADMIN_EMAIL && user.tenantId !== targetId) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const tenant = await getTenantById(targetId, fastify.prisma);
    return reply.send({ tenant });
  });

  // Update tenant settings
  fastify.patch<{ Params: TenantParams; Body: UpdateTenantBody }>(
    '/tenants/:id',
    { schema: { body: updateTenantJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      const targetId = request.params.id;

      const isSuperadmin = user.email === env.SUPERADMIN_EMAIL;
      const isOwnerOrAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

      // Multi-tenancy: only owner/admin can update their own tenant, or superadmin any
      if (!isSuperadmin && (user.tenantId !== targetId || !isOwnerOrAdmin)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }

      // Non-superadmin cannot change plan or status
      if (!isSuperadmin && (request.body.plan || request.body.status)) {
        return reply.status(403).send({ error: 'Plan and status changes require superadmin' });
      }

      const tenant = await updateTenant(
        targetId,
        request.body,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.send({ tenant });
    },
  );
};

export default tenantsRoutes;
