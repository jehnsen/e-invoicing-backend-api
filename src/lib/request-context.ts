import { FastifyRequest } from 'fastify';

export type UserAuth = NonNullable<FastifyRequest['user']>;
export type ApiKeyAuth = NonNullable<FastifyRequest['apiKey']>;

/**
 * Extracts the authenticated user from a request.
 * Throws 401 if called on an unauthenticated request (defensive — should never happen
 * behind the authenticate preHandler, but prevents TypeScript unsafe casts).
 */
export function assertUser(request: FastifyRequest): UserAuth {
  if (!request.user) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  return request.user;
}

/**
 * Extracts the authenticated API key context from a request.
 * Throws 401 if called outside authenticateApiKey preHandler.
 */
export function assertApiKey(request: FastifyRequest): ApiKeyAuth {
  if (!request.apiKey) {
    throw Object.assign(new Error('API key authentication required'), { statusCode: 401 });
  }
  return request.apiKey;
}
