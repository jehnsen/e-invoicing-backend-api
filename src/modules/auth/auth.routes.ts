import { FastifyPluginAsync } from 'fastify';
import {
  registerBodySchema,
  loginBodySchema,
  refreshBodySchema,
  registerJsonSchema,
  loginJsonSchema,
  refreshJsonSchema,
  RegisterBody,
  LoginBody,
  RefreshBody,
} from './auth.schema';
import { registerTenant, loginUser, refreshAccessToken, logoutUser } from './auth.service';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: { body: registerJsonSchema },
      // Prevent automated account creation: 3 registrations per IP per hour
      config: { rateLimit: { max: 3, timeWindow: '1 hour', keyGenerator: (req) => req.ip } },
    },
    async (request, reply) => {
      const tokens = await registerTenant(request.body, fastify);
      return reply.status(201).send(tokens);
    },
  );

  fastify.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: { body: loginJsonSchema },
      // Brute-force protection: 10 login attempts per IP per 15 minutes
      config: { rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } },
    },
    async (request, reply) => {
      const tokens = await loginUser(request.body, fastify);
      return reply.send(tokens);
    },
  );

  fastify.post<{ Body: RefreshBody }>(
    '/auth/refresh',
    {
      schema: { body: refreshJsonSchema },
      // Refresh tokens are single-use; cap at 30/min to catch token stuffing
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req) => req.ip } },
    },
    async (request, reply) => {
      const tokens = await refreshAccessToken(request.body.refreshToken, fastify);
      return reply.send(tokens);
    },
  );

  fastify.post<{ Body: RefreshBody }>(
    '/auth/logout',
    { schema: { body: refreshJsonSchema }, preHandler: [fastify.authenticate] },
    async (request, reply) => {
      await logoutUser(request.body.refreshToken, fastify.prisma);
      return reply.status(204).send();
    },
  );
};

export default authRoutes;
