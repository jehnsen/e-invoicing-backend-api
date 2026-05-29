import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = new PrismaClient();

  await prisma.$connect();
  logger.info('Prisma connected to PostgreSQL');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
  });
});

export default prismaPlugin;
