// ============================================================
// Chronos — PostgreSQL Database Module
// ============================================================
// Manages the PostgreSQL connection pool, schema initialization,
// and provides a query interface for the persistence layer.
//
// PostgreSQL is the durable source of truth for:
// - Saga instances and their execution state
// - Workflow definitions and versions
// - Step execution logs (write-ahead log)
// - Event history (append-only audit trail)
// - Idempotency keys
// ============================================================

import pg from 'pg';
import { type AppConfig } from '../config/index.js';

const { Pool } = pg;
export type { Pool } from 'pg';

let pool: pg.Pool | null = null;

/**
 * Initialize the PostgreSQL connection pool.
 *
 * Uses pg.Pool which maintains a pool of reusable connections,
 * avoiding the overhead of creating a new connection per query.
 */
export function createPool(config: AppConfig): pg.Pool {
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,                      // Maximum pool size
    idleTimeoutMillis: 30000,     // Close idle connections after 30s
    connectionTimeoutMillis: 5000, // Timeout acquiring a connection
  });

  // Log pool errors (don't crash the process)
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });

  return pool;
}

/**
 * Get the current PostgreSQL pool instance.
 * Throws if the pool hasn't been initialized.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized. Call createPool() first.');
  }
  return pool;
}

/**
 * Check PostgreSQL connectivity by running a simple query.
 */
export async function checkConnection(dbPool: pg.Pool): Promise<boolean> {
  try {
    await dbPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the database schema.
 *
 * Creates all tables required by Chronos if they don't exist.
 * Uses IF NOT EXISTS so it's safe to run on every startup.
 */
export async function initializeSchema(dbPool: pg.Pool): Promise<void> {
  const schemaSQL = `
    -- ── Workflows ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS workflows (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL,
      version         INT NOT NULL DEFAULT 1,
      description     TEXT,
      steps           JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(name, version)
    );

    -- ── Saga Instances ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS saga_instances (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_name     VARCHAR(255) NOT NULL,
      workflow_version  INT NOT NULL DEFAULT 1,
      status            VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      current_step_index INT NOT NULL DEFAULT 0,
      payload           JSONB NOT NULL DEFAULT '{}',
      context           JSONB NOT NULL DEFAULT '{}',
      error             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Index for crash recovery: find unfinished sagas
    CREATE INDEX IF NOT EXISTS idx_saga_instances_status
      ON saga_instances(status)
      WHERE status IN ('EXECUTING', 'COMPENSATING');

    -- ── Saga Step Logs ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS saga_step_logs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      saga_instance_id  UUID NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
      step_name         VARCHAR(255) NOT NULL,
      step_type         VARCHAR(20) NOT NULL,
      status            VARCHAR(50) NOT NULL,
      request_payload   JSONB,
      response_payload  JSONB,
      error_message     TEXT,
      execution_time_ms INT,
      attempt           INT NOT NULL DEFAULT 1,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_saga_step_logs_instance
      ON saga_step_logs(saga_instance_id);

    -- ── Saga Events (append-only event log) ───────────────
    CREATE TABLE IF NOT EXISTS saga_events (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      saga_instance_id  UUID NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
      event_type        VARCHAR(50) NOT NULL,
      step_name         VARCHAR(255),
      payload           JSONB,
      error             TEXT,
      timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_saga_events_instance
      ON saga_events(saga_instance_id);

    CREATE INDEX IF NOT EXISTS idx_saga_events_timestamp
      ON saga_events(timestamp);

    -- ── Idempotency Keys ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key               VARCHAR(512) PRIMARY KEY,
      saga_instance_id  UUID NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
      step_name         VARCHAR(255) NOT NULL,
      step_type         VARCHAR(20) NOT NULL,
      status            VARCHAR(50) NOT NULL,
      response          JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Dead Letter Queue ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      saga_instance_id  UUID NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
      step_name         VARCHAR(255) NOT NULL,
      step_type         VARCHAR(20) NOT NULL,
      error_message     TEXT,
      payload           JSONB,
      attempts          INT NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at       TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_unresolved
      ON dead_letter_queue(created_at)
      WHERE resolved_at IS NULL;
  `;

  await dbPool.query(schemaSQL);
}

/**
 * Close the PostgreSQL pool gracefully.
 * Waits for all active queries to complete before closing.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
