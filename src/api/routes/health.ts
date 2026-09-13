// ============================================================
// SagaFlow — Health Check Route
// ============================================================
// Provides a /health endpoint that reports the status of all
// SagaFlow dependencies (PostgreSQL, Redis).
//
// Used for:
// - Docker health checks
// - Load balancer probes
// - Quick debugging of connectivity issues
// ============================================================

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type HealthCheckResponse } from '../../types/index.js';

const startTime = Date.now();

/**
 * Health check response schema for documentation and validation.
 */
const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
  services: z.object({
    postgresql: z.enum(['connected', 'disconnected']),
    redis: z.enum(['connected', 'disconnected']),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Register the /health route on the Fastify instance.
 *
 * Initially, PostgreSQL and Redis are reported as 'disconnected'
 * since the connection modules are not yet integrated (Commit 3).
 * The route structure is in place for when they are.
 */
export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    // Check PostgreSQL connectivity
    const pgStatus = await checkPostgres();

    // Check Redis connectivity
    const redisStatus = await checkRedis();

    const overallStatus: HealthCheckResponse['status'] =
      pgStatus === 'connected' && redisStatus === 'connected'
        ? 'healthy'
        : pgStatus === 'disconnected' && redisStatus === 'disconnected'
          ? 'unhealthy'
          : 'degraded';

    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: '0.1.0',
      services: {
        postgresql: pgStatus,
        redis: redisStatus,
      },
    };

    const statusCode = overallStatus === 'healthy' ? 200 : 503;
    return reply.status(statusCode).send(response);
  });
}

/**
 * Check PostgreSQL connectivity.
 * Placeholder — will be integrated with the actual pool in Commit 3.
 */
async function checkPostgres(): Promise<'connected' | 'disconnected'> {
  // Will be replaced with actual pool.query('SELECT 1') check
  return 'disconnected';
}

/**
 * Check Redis connectivity.
 * Placeholder — will be integrated with the actual client in Commit 3.
 */
async function checkRedis(): Promise<'connected' | 'disconnected'> {
  // Will be replaced with actual redis.ping() check
  return 'disconnected';
}
