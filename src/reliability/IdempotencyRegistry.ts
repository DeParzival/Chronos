// ============================================================
// Chronos — Idempotency Registry
// ============================================================
// Stores idempotency results in PostgreSQL so that retried
// step executions can return cached results instead of
// executing the operation again.
//
// Flow:
//   1. Generate key: "saga-abc:payment:ACTION"
//   2. Check registry → key exists? → return cached result
//   3. Key doesn't exist → execute step
//   4. Store result against the key
//   5. On retry: step 2 returns cached → skip execution
// ============================================================

import { type Pool } from 'pg';

/**
 * Stored idempotency result.
 */
export interface IdempotencyRecord {
  key: string;
  response: Record<string, unknown>;
  statusCode: number;
  createdAt: Date;
  expiresAt: Date;
}

export class IdempotencyRegistry {
  /** Default TTL: 24 hours */
  private readonly ttlMs: number;

  constructor(
    private readonly pool: Pool,
    ttlMs: number = 24 * 60 * 60 * 1000
  ) {
    this.ttlMs = ttlMs;
  }

  /**
   * Check if an idempotency key already has a stored result.
   *
   * @returns The cached result if found and not expired, null otherwise
   */
  async check(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      `SELECT key, response, status_code, created_at, expires_at
       FROM idempotency_keys
       WHERE key = $1 AND expires_at > NOW()`,
      [key]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      key: row.key as string,
      response: row.response as Record<string, unknown>,
      statusCode: row.status_code as number,
      createdAt: new Date(row.created_at as string),
      expiresAt: new Date(row.expires_at as string),
    };
  }

  /**
   * Store a step execution result against its idempotency key.
   *
   * Uses INSERT ... ON CONFLICT DO NOTHING to handle race conditions
   * where two instances try to store the same key simultaneously.
   */
  async store(
    key: string,
    response: Record<string, unknown>,
    statusCode: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.pool.query(
      `INSERT INTO idempotency_keys (key, response, status_code, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(response), statusCode, expiresAt]
    );
  }

  /**
   * Remove expired idempotency keys.
   *
   * Should be called periodically (e.g., via a cron job)
   * to prevent the table from growing unbounded.
   *
   * @returns Number of keys removed
   */
  async cleanup(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM idempotency_keys WHERE expires_at <= NOW()`
    );
    return result.rowCount ?? 0;
  }

  /**
   * Remove a specific idempotency key.
   * Useful for forcing re-execution of a step.
   */
  async remove(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM idempotency_keys WHERE key = $1`,
      [key]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
