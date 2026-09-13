// ============================================================
// SagaFlow — Fastify Server Setup
// ============================================================
// Creates and configures the Fastify application instance with
// logging, error handling, and graceful shutdown.
// ============================================================

import Fastify, { type FastifyInstance } from 'fastify';
import { type AppConfig } from '../config/index.js';
import { registerHealthRoute } from '../api/routes/health.js';

/**
 * Build and configure the Fastify application.
 *
 * This function creates the Fastify instance but does NOT start
 * listening. Call `app.listen()` separately to start the server.
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
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
