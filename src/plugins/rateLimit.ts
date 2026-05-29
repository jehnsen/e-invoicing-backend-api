import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env';

const rateLimitPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(import('@fastify/rate-limit'), {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Key by tenantId when available, otherwise by IP
    keyGenerator(request) {
      return request.tenantId ?? request.ip;
    },
    errorResponseBuilder(_request, context) {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded — max ${context.max} requests per minute per tenant`,
        retryAfter: context.ttl,
      };
    },
    // Routes that bypass rate limiting
    allowList: ['/healthz'],
  });
});

export default rateLimitPlugin;