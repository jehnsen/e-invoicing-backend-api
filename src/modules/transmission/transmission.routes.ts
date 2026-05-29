import { FastifyPluginAsync } from 'fastify';
import { TransmissionQuery } from './transmission.schema';
import { listTransmissions } from './transmission.service';
import { assertUser } from '../../lib/request-context';

const transmissionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get<{ Querystring: TransmissionQuery }>(
    '/transmissions',
    async (request, reply) => {
      const user = assertUser(request);
      const result = await listTransmissions(user.tenantId, request.query, fastify.prisma);
      return reply.send(result);
    },
  );
};

export default transmissionRoutes;
