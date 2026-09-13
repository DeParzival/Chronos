// ============================================================
// Chronos — Application Entry Point
// ============================================================
// Bootstraps the Chronos application:
// 1. Loads and validates configuration
// 2. Builds the Fastify app (with DB connections)
// 3. Starts listening for HTTP requests
// 4. Handles graceful shutdown
// ============================================================

import { loadConfig } from './config/index.js';
import { buildApp } from './app.js';
import { closePool } from './persistence/database.js';
import { closeRedisClient } from './persistence/redis.js';

async function main(): Promise<void> {
  // ── Load configuration ──────────────────────────────────
  const config = loadConfig();

  // ── Build Fastify app ───────────────────────────────────
  const app = await buildApp(config);

  // ── Graceful shutdown ───────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await app.close();
      await closeRedisClient();
      await closePool();
      app.log.info('All connections closed. Goodbye.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Start server ────────────────────────────────────────
  try {
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    app.log.info(`Chronos is running on port ${config.port}`);
    app.log.info(`Environment: ${config.nodeEnv}`);
    app.log.info(`Health check: http://localhost:${config.port}/health`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
