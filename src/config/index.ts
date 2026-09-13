// ============================================================
// Chronos — Configuration Module
// ============================================================
// Centralized configuration loaded from environment variables.
// Uses Zod for validation to ensure all required config is present
// and correctly typed at startup time.
// ============================================================

import { z } from 'zod';

/**
 * Configuration schema — validates environment variables at startup.
 * If any required variable is missing or invalid, the application
 * will fail fast with a clear error message.
 */
const ConfigSchema = z.object({
  // Server
  port: z.coerce.number().int().positive().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PostgreSQL
  databaseUrl: z.string().url().startsWith('postgresql://'),

  // Redis
  redisUrl: z.string().url().startsWith('redis://'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables.
 * Throws a ZodError with detailed messages if validation fails.
 */
export function loadConfig(): AppConfig {
  const raw = {
    port: process.env['PORT'],
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
    databaseUrl: process.env['DATABASE_URL'],
    redisUrl: process.env['REDIS_URL'],
  };

  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`
    );
    throw new Error(
      `Configuration validation failed:\n${errors.join('\n')}\n\nCheck your environment variables or .env file.`
    );
  }

  return result.data;
}
