// ============================================================
// Chronos — Dead Letter Queue
// ============================================================
// Captures unrecoverable saga failures for manual investigation
// and replay. Backed by PostgreSQL's dead_letter_queue table.
//
// When a saga exhausts all retries and compensations fail,
// it's sent to the DLQ with full context so operators can:
//   1. Inspect what went wrong
//   2. Fix the underlying issue
//   3. Replay the saga
// ============================================================

import { type Pool } from 'pg';

// ── Types ──────────────────────────────────────────────────

export interface DeadLetterEntry {
  id: string;
  sagaId: string;
  workflowName: string;
  error: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  retryCount: number;
  acknowledged: boolean;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface DeadLetterStats {
  total: number;
  unacknowledged: number;
  acknowledged: number;
}

// ── Dead Letter Queue ──────────────────────────────────────

export class DeadLetterQueue {
  constructor(private readonly pool: Pool) {}

  /**
   * Add a failed saga to the dead letter queue.
   */
  async enqueue(
    sagaId: string,
    workflowName: string,
    error: string,
    payload: Record<string, unknown> = {},
    context: Record<string, unknown> = {},
    retryCount: number = 0
  ): Promise<DeadLetterEntry> {
    const result = await this.pool.query(
      `INSERT INTO dead_letter_queue
         (saga_instance_id, workflow_name, error, payload, context, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sagaId, workflowName, error, JSON.stringify(payload), JSON.stringify(context), retryCount]
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get a dead letter entry by ID.
   */
  async findById(id: string): Promise<DeadLetterEntry | null> {
    const result = await this.pool.query(
      `SELECT * FROM dead_letter_queue WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Get all unacknowledged entries.
   */
  async findUnacknowledged(
    limit: number = 50,
    offset: number = 0
  ): Promise<DeadLetterEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM dead_letter_queue
       WHERE acknowledged = false
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Get all entries for a specific saga.
   */
  async findBySagaId(sagaId: string): Promise<DeadLetterEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM dead_letter_queue
       WHERE saga_instance_id = $1
       ORDER BY created_at DESC`,
      [sagaId]
    );

    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Acknowledge a dead letter entry (mark as processed).
   */
  async acknowledge(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE dead_letter_queue
       SET acknowledged = true, acknowledged_at = NOW()
       WHERE id = $1 AND acknowledged = false`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Acknowledge all entries for a saga.
   */
  async acknowledgeBySagaId(sagaId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE dead_letter_queue
       SET acknowledged = true, acknowledged_at = NOW()
       WHERE saga_instance_id = $1 AND acknowledged = false`,
      [sagaId]
    );

    return result.rowCount ?? 0;
  }

  /**
   * Get DLQ statistics.
   */
  async getStats(): Promise<DeadLetterStats> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE acknowledged = false)::int AS unacknowledged,
         COUNT(*) FILTER (WHERE acknowledged = true)::int AS acknowledged
       FROM dead_letter_queue`
    );

    const row = result.rows[0] ?? {};
    return {
      total: (row as Record<string, number>).total ?? 0,
      unacknowledged: (row as Record<string, number>).unacknowledged ?? 0,
      acknowledged: (row as Record<string, number>).acknowledged ?? 0,
    };
  }

  /**
   * Remove acknowledged entries older than the given date.
   * For periodic cleanup.
   */
  async purgeAcknowledged(olderThan: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM dead_letter_queue
       WHERE acknowledged = true AND acknowledged_at < $1`,
      [olderThan]
    );

    return result.rowCount ?? 0;
  }

  // ── Private ───────────────────────────────────────────

  private mapRow(row: Record<string, unknown>): DeadLetterEntry {
    return {
      id: row['id'] as string,
      sagaId: row['saga_instance_id'] as string,
      workflowName: row['workflow_name'] as string,
      error: row['error'] as string,
      payload: (typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : row['payload']) as Record<string, unknown>,
      context: (typeof row['context'] === 'string' ? JSON.parse(row['context']) : row['context']) as Record<string, unknown>,
      retryCount: row['retry_count'] as number,
      acknowledged: row['acknowledged'] as boolean,
      createdAt: new Date(row['created_at'] as string),
      acknowledgedAt: row['acknowledged_at'] ? new Date(row['acknowledged_at'] as string) : null,
    };
  }
}
