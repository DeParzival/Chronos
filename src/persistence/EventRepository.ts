// ============================================================
// Chronos — Event Repository
// ============================================================
// Manages the append-only event log in PostgreSQL.
//
// Every significant state change in a saga's lifecycle is
// recorded as an immutable event. This provides:
// - Complete audit trail of what happened
// - Debugging information for failed sagas
// - Foundation for crash recovery (Phase 5)
// ============================================================

import { type Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { type SagaEvent, type SagaEventType } from '../types/index.js';

export class EventRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Append an event to the saga's event log.
   * Events are immutable — once written, they are never modified.
   */
  async appendEvent(
    sagaInstanceId: string,
    eventType: SagaEventType,
    options: {
      stepName?: string;
      payload?: Record<string, unknown>;
      error?: string;
    } = {}
  ): Promise<SagaEvent> {
    const id = uuidv4();
    const { stepName, payload, error } = options;

    const result = await this.pool.query(
      `INSERT INTO saga_events
         (id, saga_instance_id, event_type, step_name, payload, error)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        sagaInstanceId,
        eventType,
        stepName ?? null,
        payload ? JSON.stringify(payload) : null,
        error ?? null,
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get the full event history for a saga, ordered chronologically.
   */
  async getEventsBySagaId(sagaInstanceId: string): Promise<SagaEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM saga_events
       WHERE saga_instance_id = $1
       ORDER BY timestamp ASC`,
      [sagaInstanceId]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Get events filtered by type for a saga.
   */
  async getEventsByType(
    sagaInstanceId: string,
    eventType: SagaEventType
  ): Promise<SagaEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM saga_events
       WHERE saga_instance_id = $1 AND event_type = $2
       ORDER BY timestamp ASC`,
      [sagaInstanceId, eventType]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Get the most recent event for a saga.
   */
  async getLatestEvent(sagaInstanceId: string): Promise<SagaEvent | null> {
    const result = await this.pool.query(
      `SELECT * FROM saga_events
       WHERE saga_instance_id = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [sagaInstanceId]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Count events for a saga (useful for progress tracking).
   */
  async countEvents(sagaInstanceId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM saga_events
       WHERE saga_instance_id = $1`,
      [sagaInstanceId]
    );

    return result.rows[0]?.count as number ?? 0;
  }

  /**
   * Map a database row to a SagaEvent.
   */
  private mapRow(row: Record<string, unknown>): SagaEvent {
    return {
      id: row.id as string,
      sagaInstanceId: row.saga_instance_id as string,
      eventType: row.event_type as SagaEventType,
      stepName: (row.step_name as string) ?? undefined,
      payload: (row.payload as Record<string, unknown>) ?? undefined,
      error: (row.error as string) ?? undefined,
      timestamp: new Date(row.timestamp as string),
    };
  }
}
