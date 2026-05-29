import { FastifyPluginAsync } from 'fastify';
import { saveConnectorJsonSchema, importBodyJsonSchema, SaveConnectorBody, ImportBody } from './connectors.schema';
import { processUpload, importInvoices, listConnectors, saveConnector } from './connectors.service';
import { suggestFieldMapping } from '../fieldMapping/fieldMapping.service';
import { assertUser } from '../../lib/request-context';

const connectorsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * POST /connectors/upload
   * Accepts multipart file upload, parses it, returns preview + AI field mapping suggestions.
   */
  fastify.post('/connectors/upload', async (request, reply) => {
    const user = assertUser(request);

    if (!['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);

    const parsed = await processUpload(buffer, data.filename, user.tenantId);

    // Get AI field mapping suggestions from first 5 rows
    const suggestions = await suggestFieldMapping(
      { sampleRows: parsed.previewRows, sourceHeaders: parsed.headers },
      user.tenantId,
      fastify.prisma,
    );

    return reply.send({ ...parsed, mappingSuggestions: suggestions });
  });

  /**
   * POST /connectors/import
   * Confirms field mapping and bulk-creates invoices from the uploaded file.
   */
  fastify.post<{ Body: ImportBody }>(
    '/connectors/import',
    { schema: { body: importBodyJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);

      if (!['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }

      const result = await importInvoices(
        user.tenantId,
        request.body,
        user.sub,
        user.email,
        fastify.prisma,
      );

      return reply.status(201).send(result);
    },
  );

  fastify.get('/connectors', async (request, reply) => {
    const user = assertUser(request);
    const connectors = await listConnectors(user.tenantId, fastify.prisma);
    return reply.send({ connectors });
  });

  fastify.post<{ Body: SaveConnectorBody }>(
    '/connectors',
    { schema: { body: saveConnectorJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);

      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }

      const connector = await saveConnector(user.tenantId, request.body, fastify.prisma);
      return reply.status(201).send({ connector });
    },
  );
};

export default connectorsRoutes;
