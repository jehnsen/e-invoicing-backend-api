import { FastifyPluginAsync } from 'fastify';
import {
  suggestMappingJsonSchema,
  saveMappingTemplateJsonSchema,
  SuggestMappingBody,
  SaveMappingTemplateBody,
  TemplateParams,
} from './fieldMapping.schema';
import {
  suggestFieldMapping,
  saveMappingTemplate,
  listMappingTemplates,
  deleteMappingTemplate,
} from './fieldMapping.service';
import { assertUser } from '../../lib/request-context';

const fieldMappingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post<{ Body: SuggestMappingBody }>(
    '/field-mapping/suggest',
    { schema: { body: suggestMappingJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      const suggestions = await suggestFieldMapping(request.body, user.tenantId, fastify.prisma);
      return reply.send({ suggestions });
    },
  );

  fastify.get('/field-mapping/templates', async (request, reply) => {
    const user = assertUser(request);
    const templates = await listMappingTemplates(user.tenantId, fastify.prisma);
    return reply.send({ templates });
  });

  fastify.post<{ Body: SaveMappingTemplateBody }>(
    '/field-mapping/templates',
    { schema: { body: saveMappingTemplateJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      const template = await saveMappingTemplate(user.tenantId, request.body, fastify.prisma);
      return reply.status(201).send({ template });
    },
  );

  fastify.delete<{ Params: TemplateParams }>(
    '/field-mapping/templates/:id',
    async (request, reply) => {
      const user = assertUser(request);

      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }

      await deleteMappingTemplate(user.tenantId, request.params.id, fastify.prisma);
      return reply.status(204).send();
    },
  );
};

export default fieldMappingRoutes;
