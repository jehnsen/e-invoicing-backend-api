// Load .env early so `process.env` is populated before any config parsing
import 'dotenv/config';

// Debug: show whether DATABASE_URL is present (only first 16 chars to avoid leaking secret)
if (process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.log('DATABASE_URL loaded, prefix:', process.env.DATABASE_URL.slice(0, 16));
} else {
  // eslint-disable-next-line no-console
  console.log('DATABASE_URL not set in process.env');
}
import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

// Lambda handler (for AWS Lambda deployment via @fastify/aws-lambda)
let lambdaHandler: ((event: unknown, context: unknown) => Promise<unknown>) | undefined;

export const handler = async (event: unknown, context: unknown) => {
  if (!lambdaHandler) {
    const { default: awsLambdaFastify } = await import('@fastify/aws-lambda');
    const app = await buildApp();
    await app.ready();
    lambdaHandler = awsLambdaFastify(app);
  }
  return lambdaHandler(event, context);
};

// Local development / ECS entrypoint
async function startLocal() {
  const app = await buildApp();

  try {
    const address = await app.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });

    logger.info({ address, env: env.NODE_ENV }, 'EIS Ready backend server started');

    // Start SQS workers only when both the queue URL and AWS credentials are configured
    const hasAwsCredentials = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

    if (env.SQS_INVOICE_QUEUE_URL && hasAwsCredentials) {
      const { startInvoiceProcessorWorker } = await import('./workers/invoiceProcessor.worker');
      startInvoiceProcessorWorker().catch((err) =>
        logger.error({ err }, 'Invoice processor worker crashed'),
      );
    } else if (env.SQS_INVOICE_QUEUE_URL) {
      logger.warn('SQS_INVOICE_QUEUE_URL is set but AWS credentials are missing — invoice worker not started');
    }

    if (env.SQS_ARCHIVE_QUEUE_URL && hasAwsCredentials) {
      const { startArchiverWorker } = await import('./workers/archiver.worker');
      startArchiverWorker().catch((err) =>
        logger.error({ err }, 'Archiver worker crashed'),
      );
    } else if (env.SQS_ARCHIVE_QUEUE_URL) {
      logger.warn('SQS_ARCHIVE_QUEUE_URL is set but AWS credentials are missing — archiver worker not started');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    try {
      await app.close();
      logger.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only start local server when not running in Lambda
if (process.env.AWS_LAMBDA_FUNCTION_NAME === undefined) {
  startLocal();
}
