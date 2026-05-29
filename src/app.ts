import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env } from './config/env';
import { logger } from './lib/logger';

// Plugins
import prismaPlugin from './plugins/prisma';
import authPlugin from './plugins/auth';
import rateLimitPlugin from './plugins/rateLimit';
import multipartPlugin from './plugins/multipart';

// Routes
import authRoutes from './modules/auth/auth.routes';
import tenantsRoutes from './modules/tenants/tenants.routes';
import invoicesRoutes from './modules/invoices/invoices.routes';
import transmissionRoutes from './modules/transmission/transmission.routes';
import connectorsRoutes from './modules/connectors/connectors.routes';
import fieldMappingRoutes from './modules/fieldMapping/fieldMapping.routes';
import archiveRoutes from './modules/archive/archive.routes';
import complianceRoutes from './modules/compliance/compliance.routes';
import webhooksRoutes from './modules/webhooks/webhooks.routes';
import apiKeysRoutes from './modules/apiKeys/apiKeys.routes';

// Workers (cron-scheduled)
import { retryFailedTransmissions } from './workers/retryTransmission.worker';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false, // We use our own Pino logger
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        useDefaults: true,
      },
    },
  });

  // Core plugins (order matters: prisma → auth → rateLimit → multipart)
  await fastify.register(prismaPlugin);
  await fastify.register(authPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(multipartPlugin);

  // Security headers
  await fastify.register(import('@fastify/helmet'), {
    contentSecurityPolicy: false, // API-only, no UI
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? error.statusCode ?? 500;

    if (statusCode >= 500) {
      logger.error(
        { err: error, requestId: request.id, method: request.method, url: request.url },
        'Unhandled server error',
      );
    } else {
      logger.warn(
        { statusCode, message: error.message, url: request.url },
        'Client error',
      );
    }

    reply.status(statusCode).send({
      error: error.message ?? 'Internal Server Error',
      statusCode,
    });
  });

  // Health check (no auth, excluded from rate limiting)
  fastify.get('/healthz', async (_request, reply) => {
    const checks: Record<string, unknown> = { status: 'ok', timestamp: new Date().toISOString() };

    // DB connectivity check
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch (err) {
      checks.database = 'disconnected';
      checks.status = 'degraded';
      logger.error({ err }, 'Health check: DB connection failed');
    }

    // SQS reachability — just verify env is configured
    checks.sqs = env.SQS_INVOICE_QUEUE_URL ? 'configured' : 'not-configured';
    checks.s3 = env.S3_BUCKET ? 'configured' : 'not-configured';
    checks.birApiBaseUrl = env.BIR_API_BASE_URL;

    const httpStatus = checks.status === 'ok' ? 200 : 503;
    return reply.status(httpStatus).send(checks);
  });

  // API routes
  await fastify.register(authRoutes);
  await fastify.register(tenantsRoutes);
  await fastify.register(invoicesRoutes);
  await fastify.register(transmissionRoutes);
  await fastify.register(connectorsRoutes);
  await fastify.register(fieldMappingRoutes);
  await fastify.register(archiveRoutes);
  await fastify.register(complianceRoutes);
  await fastify.register(webhooksRoutes);
  await fastify.register(apiKeysRoutes);

  // 404 handler
  fastify.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'Route not found', statusCode: 404 });
  });

  // Scheduled retry job — every 5 minutes
  if (env.NODE_ENV !== 'test') {
    const cron = await import('node-cron');
    cron.schedule('*/5 * * * *', () => {
      retryFailedTransmissions().catch((err) =>
        logger.error({ err }, 'Retry transmission cron job failed'),
      );
    });
  }

  return fastify;
}
