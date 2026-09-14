// ============================================================
// Chronos — Saga Controller
// ============================================================
// Business logic for saga lifecycle management.
// Handles creation, retrieval, retry, and manual compensation.
// ============================================================

import {
  type SagaInstance,
  type StepLog,
  SagaStatus,
} from '../../types/index.js';
import { type SagaRepository } from '../../persistence/SagaRepository.js';
import { type WorkflowRepository } from '../../persistence/WorkflowRepository.js';
import { Orchestrator } from '../../engine/Orchestrator.js';

export class SagaController {
  private readonly orchestrator: Orchestrator;

  constructor(
    private readonly sagaRepo: SagaRepository,
    private readonly workflowRepo: WorkflowRepository
  ) {
    this.orchestrator = new Orchestrator(sagaRepo, workflowRepo);
  }

  /**
   * Start a new saga execution.
   */
  async startSaga(
    workflowName: string,
    payload: Record<string, unknown>
  ): Promise<{ sagaId: string; status: SagaStatus }> {
    const result = await this.orchestrator.startSaga(workflowName, payload);

    return {
      sagaId: result.sagaId,
      status: result.finalStatus,
    };
  }

  /**
   * Get a saga instance by ID.
   */
  async getSaga(id: string): Promise<SagaInstance> {
    const saga = await this.sagaRepo.findById(id);
    if (!saga) {
      throw new SagaNotFoundError(id);
    }
    return saga;
  }

  /**
   * List sagas with optional status filter and pagination.
   */
  async listSagas(options: {
    status?: SagaStatus;
    limit: number;
    offset: number;
  }): Promise<SagaInstance[]> {
    return this.sagaRepo.list(options);
  }

  /**
   * Retry a failed or compensation-failed saga.
   * Re-runs the saga from where it left off.
   */
  async retrySaga(id: string): Promise<{ sagaId: string; status: SagaStatus }> {
    const saga = await this.sagaRepo.findById(id);
    if (!saga) {
      throw new SagaNotFoundError(id);
    }

    // Can only retry sagas that are in a failed state
    if (
      saga.status !== SagaStatus.COMPENSATION_FAILED &&
      saga.status !== SagaStatus.ROLLED_BACK
    ) {
      throw new InvalidSagaOperationError(
        id,
        'retry',
        saga.status,
        'Can only retry sagas in COMPENSATION_FAILED or ROLLED_BACK status'
      );
    }

    // Look up the workflow
    const workflow = await this.workflowRepo.findByNameAndVersion(
      saga.workflowName,
      saga.workflowVersion
    );
    if (!workflow) {
      throw new Error(`Workflow not found: ${saga.workflowName} v${saga.workflowVersion}`);
    }

    // For COMPENSATION_FAILED, retry compensation
    if (saga.status === SagaStatus.COMPENSATION_FAILED) {
      await this.orchestrator.compensateSaga(id);
      const updated = await this.sagaRepo.findById(id);
      return {
        sagaId: id,
        status: updated?.status ?? SagaStatus.COMPENSATION_FAILED,
      };
    }

    // For ROLLED_BACK, start a fresh saga with the same payload
    const result = await this.orchestrator.startSaga(saga.workflowName, saga.payload);
    return {
      sagaId: result.sagaId,
      status: result.finalStatus,
    };
  }

  /**
   * Manually trigger compensation for a saga.
   */
  async compensateSaga(id: string): Promise<{ sagaId: string; status: SagaStatus }> {
    const saga = await this.sagaRepo.findById(id);
    if (!saga) {
      throw new SagaNotFoundError(id);
    }

    if (
      saga.status !== SagaStatus.EXECUTING &&
      saga.status !== SagaStatus.COMPENSATION_FAILED
    ) {
      throw new InvalidSagaOperationError(
        id,
        'compensate',
        saga.status,
        'Can only compensate sagas in EXECUTING or COMPENSATION_FAILED status'
      );
    }

    await this.orchestrator.compensateSaga(id);
    const updated = await this.sagaRepo.findById(id);

    return {
      sagaId: id,
      status: updated?.status ?? saga.status,
    };
  }

  /**
   * Get step execution logs for a saga.
   */
  async getSagaSteps(sagaId: string): Promise<StepLog[]> {
    const saga = await this.sagaRepo.findById(sagaId);
    if (!saga) {
      throw new SagaNotFoundError(sagaId);
    }

    return this.sagaRepo.getStepLogs(sagaId);
  }
}

// ── Error Classes ─────────────────────────────────────────────

export class SagaNotFoundError extends Error {
  constructor(id: string) {
    super(`Saga "${id}" not found`);
    this.name = 'SagaNotFoundError';
  }
}

export class InvalidSagaOperationError extends Error {
  constructor(
    public readonly sagaId: string,
    public readonly operation: string,
    public readonly currentStatus: SagaStatus,
    message: string
  ) {
    super(message);
    this.name = 'InvalidSagaOperationError';
  }
}
