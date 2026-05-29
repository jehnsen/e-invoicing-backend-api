import { FastifyPluginAsync } from 'fastify';
import {
  listUsersJsonSchema,
  createUserJsonSchema,
  updateUserJsonSchema,
  changePasswordJsonSchema,
  userParamsJsonSchema,
  ListUsersQuery,
  CreateUserBody,
  UpdateUserBody,
  ChangePasswordBody,
  UserParams,
} from './users.schema';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  changePassword,
} from './users.service';
import { assertUser } from '../../lib/request-context';

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /users — list all users in tenant (OWNER/ADMIN only)
  fastify.get<{ Querystring: ListUsersQuery }>(
    '/users',
    { schema: { querystring: listUsersJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions', statusCode: 403 });
      }
      return reply.send(await listUsers(user.tenantId, request.query, fastify.prisma));
    },
  );

  // GET /users/me — own profile (must be registered before /:userId to avoid param capture)
  fastify.get('/users/me', async (request, reply) => {
    const user = assertUser(request);
    return reply.send(await getUserById(user.tenantId, user.sub, user.sub, user.role, fastify.prisma));
  });

  // GET /users/:userId — get user by ID (OWNER/ADMIN or self)
  fastify.get<{ Params: UserParams }>(
    '/users/:userId',
    { schema: { params: userParamsJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      return reply.send(
        await getUserById(user.tenantId, request.params.userId, user.sub, user.role, fastify.prisma),
      );
    },
  );

  // POST /users — create a user in the same tenant (OWNER/ADMIN only)
  fastify.post<{ Body: CreateUserBody }>(
    '/users',
    { schema: { body: createUserJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions', statusCode: 403 });
      }
      return reply.status(201).send(
        await createUser(user.tenantId, request.body, user.sub, user.email, user.role, fastify.prisma),
      );
    },
  );

  // PATCH /users/me — update own name (no role/isActive — use /:userId for that)
  fastify.patch<{ Body: Pick<UpdateUserBody, 'firstName' | 'lastName'> }>(
    '/users/me',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 100 },
            lastName: { type: 'string', minLength: 1, maxLength: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = assertUser(request);
      return reply.send(
        await updateUser(
          user.tenantId,
          user.sub,
          { firstName: request.body.firstName, lastName: request.body.lastName },
          user.sub,
          user.email,
          user.role,
          fastify.prisma,
        ),
      );
    },
  );

  // PATCH /users/:userId — update user (OWNER/ADMIN only)
  fastify.patch<{ Params: UserParams; Body: UpdateUserBody }>(
    '/users/:userId',
    { schema: { params: userParamsJsonSchema, body: updateUserJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions', statusCode: 403 });
      }
      return reply.send(
        await updateUser(
          user.tenantId,
          request.params.userId,
          request.body,
          user.sub,
          user.email,
          user.role,
          fastify.prisma,
        ),
      );
    },
  );

  // DELETE /users/:userId — soft-delete user (OWNER/ADMIN only, not self)
  fastify.delete<{ Params: UserParams }>(
    '/users/:userId',
    { schema: { params: userParamsJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      if (!['OWNER', 'ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Insufficient permissions', statusCode: 403 });
      }
      await deleteUser(
        user.tenantId,
        request.params.userId,
        user.sub,
        user.email,
        user.role,
        fastify.prisma,
      );
      return reply.status(204).send();
    },
  );

  // POST /users/me/password — change own password, revokes all existing sessions
  fastify.post<{ Body: ChangePasswordBody }>(
    '/users/me/password',
    { schema: { body: changePasswordJsonSchema } },
    async (request, reply) => {
      const user = assertUser(request);
      await changePassword(user.tenantId, user.sub, request.body, fastify.prisma);
      return reply.status(204).send();
    },
  );
};

export default usersRoutes;
