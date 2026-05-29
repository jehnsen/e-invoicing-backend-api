import { PrismaClient } from '@prisma/client';
import { UserContext, ApiKeyContext, TenantContext } from './tenant.types';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: UserContext & { tenant: TenantContext };
    apiKey?: ApiKeyContext & { tenant: TenantContext };
    tenantId?: string;
  }
}
