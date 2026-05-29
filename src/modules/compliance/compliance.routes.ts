import { FastifyPluginAsync } from 'fastify';
import { getComplianceSummary, getAuditLog, getBirStatus } from './compliance.service';
import { auditLogQueryJsonSchema, AuditLogQuery } from './compliance.schema';
import { assertUser } from '../../lib/request-context';

const complianceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/compliance/summary', async (request, reply) => {
    const user = assertUser(request);
    const summary = await getComplianceSummary(user.tenantId, fastify.prisma);
    return reply.send(summary);
  });

  fastify.get<{ Querystring: AuditLogQuery }>(
    '/compliance/audit-log',
    { schema: { querystring: auditLogQueryJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      const result = await getAuditLog(
        user.tenantId,
        {
          cursor: request.query.cursor,
          limit: request.query.limit,
          resourceType: request.query.resourceType,
        },
        fastify.prisma,
      );
      return reply.send(result);
    },
  );

  fastify.get('/compliance/bir-status', async (_request, reply) => {
    const status = await getBirStatus();
    return reply.send(status);
  });
};

export default complianceRoutes;
