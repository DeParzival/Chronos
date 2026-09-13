// ============================================================
// Chronos — Saga Repository
// ============================================================
// Persists saga instances and step execution logs in PostgreSQL.
//
// Every state change and step result is persisted BEFORE the
// engine moves on. This write-ahead approach enables crash
// recovery — on restart, Chronos reads from PostgreSQL to
// determine exactly where each saga left off.
// ============================================================

import { type Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  type SagaInstance,
  type StepLog,
  SagaStatus,
  type StepStatus,
  type StepType,
} from '../types/index.js';
import { isValidTransition, InvalidTransitionError } from '../engine/StateMachine.js';

export class SagaRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new saga instance in PENDING status.
   */
  async create(
    workflowName: string,
    workflowVersion: number,
    payload: Record<string, unknown>
  ): Promise<SagaInstance> {
    const id = uuidv4();

    const result = await this.pool.query(
      `INSERT INTO saga_instances
         (id, workflow_name, workflow_version, status, current_step_index, payload, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, workflowName, workflowVersion, SagaStatus.PENDING, 0, JSON.stringify(payload), '{}']
    );

    return this.mapSagaRow(result.rows[0]);
  }

  /**
   * Find a saga instance by ID.
   */
  async findById(id: string): Promise<SagaInstance | null> {
    const result = await this.pool.query(
      `SELECT * FROM saga_instances WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapSagaRow(result.rows[0]);
  }

  /**
   * Update a saga's status with state machine validation.
   * Throws InvalidTransitionError if the transition is not allowed.
   */
  async updateStatus(
    id: string,
    newStatus: SagaStatus,
    error?: string
  ): Promise<SagaInstance> {
    // Fetch current status
    const current = await this.findById(id);
    if (!current) {
      throw new Error(`Saga not found: ${id}`);
    }

    // Validate the transition
    if (!isValidTransition(current.status, newStatus)) {
      throw new InvalidTransitionError(current.status, newStatus);
    }

    const result = await this.pool.query(
      `UPDATE saga_instances
       SET status = $1, error = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, error ?? null, id]
    );

    return this.mapSagaRow(result.rows[0]);
  }

  /**
   * Update the current step index for a saga.
   */
  async updateStepIndex(id: string, stepIndex: number): Promise<void> {
    await this.pool.query(
      `UPDATE saga_instances
       SET current_step_index = $1, updated_at = NOW()
       WHERE id = $2`,
      [stepIndex, id]
    );
  }

  /**
   * Update the saga's context (accumulated step results).
   */
  async updateContext(
    id: string,
    context: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `UPDATE saga_instances
       SET context = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(context), id]
    );
  }

  /**
   * List sagas, optionally filtered by status, paginated.
   */
  async list(
    options: { status?: SagaStatus; limit?: number; offset?: number } = {}
  ): Promise<SagaInstance[]> {
    const { status, limit = 20, offset = 0 } = options;

    let query: string;
    let params: unknown[];

    if (status) {
      query = `SELECT * FROM saga_instances WHERE status = $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params = [status, limit, offset];
    } else {
      query = `SELECT * FROM saga_instances
               ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      params = [limit, offset];
    }

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapSagaRow(row));
  }

  /**
   * Log a step execution attempt.
   */
  async logStep(
    sagaInstanceId: string,
    stepName: string,
    stepType: StepType,
    status: StepStatus,
    options: {
      requestPayload?: Record<string, unknown>;
      responsePayload?: Record<string, unknown>;
      errorMessage?: string;
      executionTimeMs?: number;
      attempt?: number;
    } = {}
  ): Promise<StepLog> {
    const id = uuidv4();
    const {
      requestPayload,
      responsePayload,
      errorMessage,
      executionTimeMs,
      attempt = 1,
    } = options;

    const result = await this.pool.query(
      `INSERT INTO saga_step_logs
         (id, saga_instance_id, step_name, step_type, status,
          request_payload, response_payload, error_message,
          execution_time_ms, attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        sagaInstanceId,
        stepName,
        stepType,
        status,
        requestPayload ? JSON.stringify(requestPayload) : null,
        responsePayload ? JSON.stringify(responsePayload) : null,
        errorMessage ?? null,
        executionTimeMs ?? null,
        attempt,
      ]
    );

    return this.mapStepLogRow(result.rows[0]);
  }

  /**
   * Get all step logs for a saga, ordered by creation time.
   */
  async getStepLogs(sagaInstanceId: string): Promise<StepLog[]> {
    const result = await this.pool.query(
      `SELECT * FROM saga_step_logs
       WHERE saga_instance_id = $1
       ORDER BY created_at ASC`,
      [sagaInstanceId]
    );

    return result.rows.map((row) => this.mapStepLogRow(row));
  }

  /**
   * Find sagas that are in an active (non-terminal) state.
   * Used by crash recovery to find unfinished work.
   */
  async findUnfinished(): Promise<SagaInstance[]> {
    const result = await this.pool.query(
      `SELECT * FROM saga_instances
       WHERE status IN ($1, $2, $3)
       ORDER BY created_at ASC`,
      [SagaStatus.EXECUTING, SagaStatus.COMPENSATING, SagaStatus.COMPENSATION_FAILED]
    );

    return result.rows.map((row) => this.mapSagaRow(row));
  }

  // ── Row mappers ───────────────────────────────────────────

  private mapSagaRow(row: Record<string, unknown>): SagaInstance {
    return {
      id: row.id as string,
      workflowName: row.workflow_name as string,
      workflowVersion: row.workflow_version as number,
      status: row.status as SagaStatus,
      currentStepIndex: row.current_step_index as number,
      payload: row.payload as Record<string, unknown>,
      context: row.context as Record<string, unknown>,
      error: (row.error as string) ?? undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapStepLogRow(row: Record<string, unknown>): StepLog {
    return {
      id: row.id as string,
      sagaInstanceId: row.saga_instance_id as string,
      stepName: row.step_name as string,
      stepType: row.step_type as StepType,
      status: row.status as StepStatus,
      requestPayload: (row.request_payload as Record<string, unknown>) ?? undefined,
      responsePayload: (row.response_payload as Record<string, unknown>) ?? undefined,
      errorMessage: (row.error_message as string) ?? undefined,
      executionTimeMs: (row.execution_time_ms as number) ?? undefined,
      attempt: row.attempt as number,
      createdAt: new Date(row.created_at as string),
    };
  }
}
