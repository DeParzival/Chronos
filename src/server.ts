// ============================================================
// SagaFlow — Application Entry Point
// ============================================================
// Bootstraps the SagaFlow application:
// 1. Loads and validates configuration
// 2. Builds the Fastify app
// 3. Starts listening for HTTP requests
// 4. Handles graceful shutdown
// ============================================================

import { loadConfig } from './config/index.js';
import { buildApp } from './app.js';

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
      app.log.info('Server closed');
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

    app.log.info(`SagaFlow is running on port ${config.port}`);
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
