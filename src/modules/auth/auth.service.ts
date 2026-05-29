import { PrismaClient } from '@prisma/client';
import { hash, compare } from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { RegisterBody, LoginBody } from './auth.schema';
import { logger } from '../../lib/logger';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_DAYS = 7;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Registers a new tenant and creates the owner user account.
 * Tenant starts in TRIAL status; owner gets OWNER role.
 */
export async function registerTenant(
  body: RegisterBody,
  fastify: FastifyInstance,
): Promise<TokenPair> {
  const prisma = fastify.prisma;

  const existingUser = await prisma.user.findUnique({ where: { email: body.ownerEmail } });
  if (existingUser) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
  }

  const existingTenant = await prisma.tenant.findUnique({ where: { tin: body.tin } });
  if (existingTenant) {
    throw Object.assign(new Error('TIN already registered'), { statusCode: 409 });
  }

  const passwordHash = await hash(body.ownerPassword, BCRYPT_ROUNDS);

  const { user, tenant } = await prisma.$transaction(async (tx) => {
    const newTenant = await tx.tenant.create({
      data: {
        tin: body.tin,
        registeredName: body.registeredName,
        tradeName: body.tradeName,
        address: body.address,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        plan: 'STARTER',
        status: 'TRIAL',
      },
    });

    const newUser = await tx.user.create({
      data: {
        tenantId: newTenant.id,
        email: body.ownerEmail,
        passwordHash,
        firstName: body.ownerFirstName,
        lastName: body.ownerLastName,
        role: 'OWNER',
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: newTenant.id,
        actorId: newUser.id,
        actorEmail: newUser.email,
        actorType: 'USER',
        action: 'CREATE',
        resourceType: 'Tenant',
        resourceId: newTenant.id,
        diff: { created: { tin: newTenant.tin, registeredName: newTenant.registeredName } },
      },
    });

    return { user: newUser, tenant: newTenant };
  });

  logger.info({ tenantId: tenant.id, userId: user.id }, 'New tenant registered');

  return issueTokens(user.id, tenant.id, user.email, user.role, fastify, prisma);
}

/**
 * Authenticates a user with email and password, returns a JWT token pair.
 */
export async function loginUser(
  body: LoginBody,
  fastify: FastifyInstance,
): Promise<TokenPair> {
  const prisma = fastify.prisma;

  const user = await prisma.user.findUnique({
    where: { email: body.email, deletedAt: null },
    include: { tenant: true },
  });

  if (!user || !user.isActive) {
    // Constant-time comparison to prevent user enumeration
    await hash('dummy', BCRYPT_ROUNDS);
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  const passwordValid = await compare(body.password, user.passwordHash);
  if (!passwordValid) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  if (user.tenant.status === 'SUSPENDED' || user.tenant.status === 'CANCELLED') {
    throw Object.assign(new Error('Account suspended or cancelled'), { statusCode: 403 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  logger.info({ userId: user.id, tenantId: user.tenantId }, 'User logged in');

  return issueTokens(user.id, user.tenantId, user.email, user.role, fastify, prisma);
}

/**
 * Rotates a refresh token — invalidates the old one and issues a new pair.
 * Prevents refresh token reuse attacks.
 *
 * The revoke + new-token-create are wrapped in a single transaction so a crash
 * between the two writes cannot leave the user with no valid session.
 * A second re-check inside the transaction prevents TOCTOU races where two
 * concurrent requests arrive with the same token before either revokes it.
 */
export async function refreshAccessToken(
  rawRefreshToken: string,
  fastify: FastifyInstance,
): Promise<TokenPair> {
  const prisma = fastify.prisma;

  const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');

  // Pre-check: fast path before opening a transaction
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { tenant: true } } },
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
  }

  if (!storedToken.user.isActive || storedToken.user.deletedAt) {
    throw Object.assign(new Error('User account inactive'), { statusCode: 401 });
  }

  const newRawRefreshToken = randomBytes(48).toString('base64url');
  const newTokenHash = createHash('sha256').update(newRawRefreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  // Atomic: re-validate inside transaction (TOCTOU guard) → revoke old → create new
  await prisma.$transaction(async (tx) => {
    const current = await tx.refreshToken.findUnique({ where: { tokenHash } });
    if (!current || current.revokedAt) {
      throw Object.assign(new Error('Refresh token already used'), { statusCode: 401 });
    }

    await tx.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    await tx.refreshToken.create({
      data: { userId: storedToken.user.id, tokenHash: newTokenHash, expiresAt },
    });
  });

  const accessToken = fastify.jwt.sign(
    { sub: storedToken.user.id, tenantId: storedToken.user.tenantId, email: storedToken.user.email, role: storedToken.user.role, type: 'access' },
    { expiresIn: '15m' },
  );

  return { accessToken, refreshToken: newRawRefreshToken };
}

/**
 * Revokes all refresh tokens for a user (logout).
 */
export async function logoutUser(rawRefreshToken: string, prisma: PrismaClient): Promise<void> {
  const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueTokens(
  userId: string,
  tenantId: string,
  email: string,
  role: string,
  fastify: FastifyInstance,
  prisma: PrismaClient,
): Promise<TokenPair> {
  const accessToken = fastify.jwt.sign(
    { sub: userId, tenantId, email, role, type: 'access' },
    { expiresIn: '15m' },
  );

  const rawRefreshToken = randomBytes(48).toString('base64url');
  const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}
