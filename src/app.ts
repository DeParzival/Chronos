// ============================================================
// Chronos — Fastify Server Setup
// ============================================================
// Creates and configures the Fastify application instance with
// logging, error handling, database connections, and routes.
// ============================================================

import Fastify, { type FastifyInstance } from 'fastify';
import { type AppConfig } from './config/index.js';
import { createPool, initializeSchema } from './persistence/database.js';
import { createRedisClient } from './persistence/redis.js';
import { registerHealthRoute } from './api/routes/health.js';

/**
 * Build and configure the Fastify application.
 *
 * Initializes database connections, schema, and registers all routes.
 * Set `skipDb` to true for unit tests that don't need real connections.
 */
export async function buildApp(
  config: AppConfig,
  options: { skipDb?: boolean } = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
                colorize: true,
              },
            }
          : undefined,
    },
  });

  // ── Database connections ────────────────────────────────
  if (!options.skipDb) {
    try {
      // PostgreSQL
      const pool = createPool(config);
      await initializeSchema(pool);
      app.decorate('dbPool', pool);
      app.log.info('PostgreSQL: connected and schema initialized');

      // Redis
      const redis = createRedisClient(config);
      app.decorate('redis', redis);
      app.log.info('Redis: client created');
    } catch (err) {
      app.log.error({ err }, 'Failed to initialize database connections');
      throw err;
    }
  }

  // ── Global error handler ──────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');

    // Zod validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Request validation failed',
        details: error.validation,
      });
    }

    // Known Fastify errors
    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: error.name,
        message: error.message,
      });
    }

    // Unknown errors
    return reply.status(500).send({
      error: 'Internal Server Error',
      message:
        config.nodeEnv === 'production'
          ? 'An unexpected error occurred'
          : error.message,
    });
  });

  // ── Not Found handler ─────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: 'Not Found',
      message: 'The requested resource was not found',
    });
  });

  // ── Register routes ───────────────────────────────────────
  await app.register(registerHealthRoute);

  return app;
}
