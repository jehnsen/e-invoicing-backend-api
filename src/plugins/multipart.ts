import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

const multipartPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024,  // 50 MB max per file
      files: 1,                     // one file per request
      fields: 10,
    },
    attachFieldsToBody: false,
  });
});

export default multipartPlugin;
