// ============================================================
// SagaFlow — Health Check Route
// ============================================================
// Provides a /health endpoint that reports the status of all
// SagaFlow dependencies (PostgreSQL, Redis).
// ============================================================

import { type FastifyInstance } from 'fastify';
import { type Pool } from 'pg';
import { type Redis } from 'ioredis';
import { type HealthCheckResponse } from '../../types/index.js';
import { checkConnection } from '../../persistence/database.js';
import { checkRedisConnection } from '../../persistence/redis.js';

const startTime = Date.now();

/**
 * Register the /health route on the Fastify instance.
 *
 * Accepts optional pool/redis references via Fastify decorators.
 * Falls back to 'disconnected' if not yet initialized.
 */
export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    // Attempt to get pool/redis from Fastify decorators
    const pool = (app as unknown as { dbPool?: Pool }).dbPool;
    const redis = (app as unknown as { redis?: Redis }).redis;

    // Check PostgreSQL connectivity
    let pgStatus: 'connected' | 'disconnected' = 'disconnected';
    if (pool) {
      pgStatus = (await checkConnection(pool)) ? 'connected' : 'disconnected';
    }

    // Check Redis connectivity
    let redisStatus: 'connected' | 'disconnected' = 'disconnected';
    if (redis) {
      redisStatus = (await checkRedisConnection(redis)) ? 'connected' : 'disconnected';
    }

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
