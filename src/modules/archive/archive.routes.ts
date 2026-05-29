import { FastifyPluginAsync } from 'fastify';

// Archive retrieval is handled in invoices.routes.ts at GET /invoices/:id/archive
// This file exports the route plugin for any additional archive-specific endpoints

const archiveRoutes: FastifyPluginAsync = async (_fastify) => {
  // Intentionally empty — archive endpoints are registered in invoices.routes.ts
  // to keep the URL structure at /invoices/:id/archive
};

export default archiveRoutes;
