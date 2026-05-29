import { FastifyPluginAsync } from 'fastify';
import {
  createInvoiceJsonSchema,
  updateInvoiceJsonSchema,
  cancelInvoiceJsonSchema,
  CreateInvoiceBody,
  UpdateInvoiceBody,
  InvoiceQuery,
  CancelInvoiceBody,
  InvoiceParams,
} from './invoices.schema';
import {
  createInvoice,
  listInvoices,
  getInvoiceById,
  updateInvoice,
  submitInvoice,
  cancelInvoice,
  syncInvoiceStatus,
} from './invoices.service';
import { getArchiveRecord } from '../archive/archive.service';
import { assertUser } from '../../lib/request-context';

const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post<{ Body: CreateInvoiceBody }>(
    '/invoices',
    { schema: { body: createInvoiceJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
      const invoice = await createInvoice(
        user.tenantId,
        request.body,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.status(201).send({ invoice });
    },
  );

  fastify.get<{ Querystring: InvoiceQuery }>('/invoices', async (request, reply) => {
    const user = assertUser(request);
    const result = await listInvoices(user.tenantId, request.query, fastify.prisma);
    return reply.send(result);
  });

  fastify.get<{ Params: InvoiceParams }>('/invoices/:id', async (request, reply) => {
    const user = assertUser(request);
    const invoice = await getInvoiceById(user.tenantId, request.params.id, fastify.prisma);
    return reply.send({ invoice });
  });

  fastify.patch<{ Params: InvoiceParams; Body: UpdateInvoiceBody }>(
    '/invoices/:id',
    { schema: { body: updateInvoiceJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
      const invoice = await updateInvoice(
        user.tenantId,
        request.params.id,
        request.body,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.send({ invoice });
    },
  );

  fastify.post<{ Params: InvoiceParams }>(
    '/invoices/:id/submit',
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
      const result = await submitInvoice(
        user.tenantId,
        request.params.id,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.send(result);
    },
  );

  fastify.post<{ Params: InvoiceParams; Body: CancelInvoiceBody }>(
    '/invoices/:id/cancel',
    { schema: { body: cancelInvoiceJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only OWNER or ADMIN can cancel invoices' });
      }
      const result = await cancelInvoice(
        user.tenantId,
        request.params.id,
        request.body,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.send(result);
    },
  );

  fastify.post<{ Params: InvoiceParams }>(
    '/invoices/:id/sync-status',
    async (request, reply) => {
      const user = assertUser(request);
      const result = await syncInvoiceStatus(
        user.tenantId,
        request.params.id,
        user.sub,
        user.email,
        fastify.prisma,
      );
      return reply.send(result);
    },
  );

  fastify.get<{ Params: InvoiceParams }>(
    '/invoices/:id/archive',
    async (request, reply) => {
      const user = assertUser(request);
      const result = await getArchiveRecord(user.tenantId, request.params.id, fastify.prisma);
      return reply.send(result);
    },
  );
};

export default invoicesRoutes;
