// ============================================================
// Chronos — Event Logger
// ============================================================
// High-level event logging service that records every
// significant state change in a saga's lifecycle.
//
// This is the write-ahead log that enables crash recovery.
// Every event is persisted to PostgreSQL BEFORE the engine
// acts on it, so on restart we can reconstruct exactly
// where each saga left off.
// ============================================================

import { type SagaEventType } from '../types/index.js';
import { type EventRepository } from '../persistence/EventRepository.js';

/**
 * Structured event logger for saga lifecycle tracking.
 * Wraps EventRepository with typed convenience methods.
 */
export class EventLogger {
  constructor(private readonly eventRepo: EventRepository) {}

  // ── Saga lifecycle events ─────────────────────────────

  async sagaStarted(
    sagaId: string,
    workflowName: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'SAGA_STARTED' as SagaEventType, {
      payload: { workflowName, ...payload },
    });
  }

  async sagaCompleted(sagaId: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'SAGA_COMPLETED' as SagaEventType);
  }

  async sagaRolledBack(sagaId: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'SAGA_ROLLED_BACK' as SagaEventType);
  }

  async sagaCompensationFailed(sagaId: string, error: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'SAGA_COMPENSATION_FAILED' as SagaEventType, {
      error,
    });
  }

  // ── Step execution events ─────────────────────────────

  async stepStarted(sagaId: string, stepName: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'STEP_STARTED' as SagaEventType, {
      stepName,
    });
  }

  async stepSucceeded(
    sagaId: string,
    stepName: string,
    response?: Record<string, unknown>
  ): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'STEP_SUCCEEDED' as SagaEventType, {
      stepName,
      payload: response,
    });
  }

  async stepFailed(
    sagaId: string,
    stepName: string,
    error: string
  ): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'STEP_FAILED' as SagaEventType, {
      stepName,
      error,
    });
  }

  // ── Compensation events ───────────────────────────────

  async compensationStarted(sagaId: string, stepName: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'COMPENSATION_STARTED' as SagaEventType, {
      stepName,
    });
  }

  async compensationSucceeded(sagaId: string, stepName: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'COMPENSATION_SUCCEEDED' as SagaEventType, {
      stepName,
    });
  }

  async compensationFailed(
    sagaId: string,
    stepName: string,
    error: string
  ): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'COMPENSATION_FAILED' as SagaEventType, {
      stepName,
      error,
    });
  }

  // ── Recovery events ───────────────────────────────────

  async recoveryStarted(sagaId: string, fromStatus: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'RECOVERY_STARTED' as SagaEventType, {
      payload: { previousStatus: fromStatus },
    });
  }

  async recoveryCompleted(sagaId: string, finalStatus: string): Promise<void> {
    await this.eventRepo.appendEvent(sagaId, 'RECOVERY_COMPLETED' as SagaEventType, {
      payload: { finalStatus },
    });
  }
}
