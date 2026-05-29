import { PrismaClient, User } from '@prisma/client';
import { hash, compare } from 'bcryptjs';
import { logger } from '../../lib/logger';
import { CreateUserBody, UpdateUserBody, ChangePasswordBody, ListUsersQuery } from './users.schema';

const BCRYPT_ROUNDS = 12;

const ROLE_RANK: Record<string, number> = {
  OWNER: 4,
  ADMIN: 3,
  ACCOUNTANT: 2,
  VIEWER: 1,
};

function assertCanManage(actorRole: string, targetRole: string, action = 'manage') {
  if ((ROLE_RANK[actorRole] ?? 0) <= (ROLE_RANK[targetRole] ?? 0)) {
    throw Object.assign(
      new Error(`Insufficient permissions to ${action} users with role ${targetRole}`),
      { statusCode: 403 },
    );
  }
}

function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function listUsers(
  tenantId: string,
  query: ListUsersQuery,
  prisma: PrismaClient,
) {
  const where: NonNullable<Parameters<PrismaClient['user']['findMany']>[0]>['where'] = {
    tenantId,
    deletedAt: null,
  };

  if (query.role) where.role = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.cursor) where.id = { lt: query.cursor };

  const limit = query.limit ?? 20;
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;

  return {
    items: items.map(serializeUser),
    nextCursor: hasMore ? items[items.length - 1].id : undefined,
  };
}

export async function getUserById(
  tenantId: string,
  userId: string,
  actorId: string,
  actorRole: string,
  prisma: PrismaClient,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  if (actorId !== userId && (ROLE_RANK[actorRole] ?? 0) < ROLE_RANK['ADMIN']) {
    throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
  }

  return serializeUser(user);
}

export async function createUser(
  tenantId: string,
  body: CreateUserBody,
  actorId: string,
  actorEmail: string,
  actorRole: string,
  prisma: PrismaClient,
) {
  assertCanManage(actorRole, body.role, 'create');

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw Object.assign(new Error('Email already registered'), { statusCode: 409 });

  const passwordHash = await hash(body.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      passwordHash,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'CREATE',
      resourceType: 'User',
      resourceId: user.id,
      diff: { email: user.email, role: user.role },
    },
  });

  logger.info({ tenantId, userId: user.id, createdBy: actorId }, 'User created');
  return serializeUser(user);
}

export async function updateUser(
  tenantId: string,
  userId: string,
  body: UpdateUserBody,
  actorId: string,
  actorEmail: string,
  actorRole: string,
  prisma: PrismaClient,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  assertCanManage(actorRole, user.role, 'update');

  if (body.role) {
    assertCanManage(actorRole, body.role, 'assign role');
    if (actorId === userId) {
      throw Object.assign(new Error('Cannot change your own role'), { statusCode: 422 });
    }
  }

  const updateData: NonNullable<Parameters<PrismaClient['user']['update']>[0]>['data'] = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const updated = await prisma.user.update({ where: { id: userId }, data: updateData });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: userId,
      diff: { updated: Object.keys(body) },
    },
  });

  return serializeUser(updated);
}

export async function deleteUser(
  tenantId: string,
  userId: string,
  actorId: string,
  actorEmail: string,
  actorRole: string,
  prisma: PrismaClient,
) {
  if (actorId === userId) {
    throw Object.assign(new Error('Cannot delete your own account'), { statusCode: 422 });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  assertCanManage(actorRole, user.role, 'delete');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId,
      actorEmail,
      actorType: 'USER',
      action: 'DELETE',
      resourceType: 'User',
      resourceId: userId,
    },
  });

  logger.info({ tenantId, userId, deletedBy: actorId }, 'User deleted');
}

export async function changePassword(
  tenantId: string,
  userId: string,
  body: ChangePasswordBody,
  prisma: PrismaClient,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  const valid = await compare(body.currentPassword, user.passwordHash);
  if (!valid) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 });

  const newHash = await hash(body.newPassword, BCRYPT_ROUNDS);

  // Atomic: update password + revoke all sessions to force re-login
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  logger.info({ tenantId, userId }, 'Password changed');
}
