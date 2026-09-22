// ============================================================
// Chronos — Crash Recovery Module
// ============================================================
// On startup, scans for unfinished sagas and resumes them.
//
// Recovery strategy by saga status:
//   EXECUTING           → resume forward execution from last completed step
//   COMPENSATING        → resume compensation from where it stopped
//   COMPENSATION_FAILED → retry compensation for remaining steps
//
// This module reads step logs to determine exactly where each
// saga left off, then delegates to the appropriate engine.
// ============================================================

import {
  type SagaInstance,
  type WorkflowDefinition,
  type StepLog,
  SagaStatus,
  StepStatus,
  StepType,
} from '../types/index.js';
import { type SagaRepository } from '../persistence/SagaRepository.js';
import { type WorkflowRepository } from '../persistence/WorkflowRepository.js';
import { SagaEngine } from '../engine/SagaEngine.js';
import { CompensationEngine } from '../engine/CompensationEngine.js';
import { EventLogger } from './EventLogger.js';

/**
 * Result of a recovery attempt for a single saga.
 */
export interface RecoveryResult {
  sagaId: string;
  previousStatus: SagaStatus;
  finalStatus: SagaStatus;
  action: 'resumed_execution' | 'resumed_compensation' | 'skipped';
  error?: string;
}

/**
 * Result of the full recovery scan.
 */
export interface RecoveryScanResult {
  totalFound: number;
  recovered: RecoveryResult[];
  failed: RecoveryResult[];
  skipped: number;
}

export class CrashRecovery {
  constructor(
    private readonly sagaRepo: SagaRepository,
    private readonly workflowRepo: WorkflowRepository,
    private readonly eventLogger: EventLogger | null = null
  ) {}

  /**
   * Scan for and recover all unfinished sagas.
   * Call this on application startup.
   */
  async recoverAll(): Promise<RecoveryScanResult> {
    const unfinished = await this.sagaRepo.findUnfinished();

    const result: RecoveryScanResult = {
      totalFound: unfinished.length,
      recovered: [],
      failed: [],
      skipped: 0,
    };

    for (const saga of unfinished) {
      try {
        const recoveryResult = await this.recoverSaga(saga);

        if (recoveryResult.action === 'skipped') {
          result.skipped++;
        } else if (
          recoveryResult.finalStatus === SagaStatus.COMPLETED ||
          recoveryResult.finalStatus === SagaStatus.ROLLED_BACK
        ) {
          result.recovered.push(recoveryResult);
        } else {
          result.failed.push(recoveryResult);
        }
      } catch (err) {
        result.failed.push({
          sagaId: saga.id,
          previousStatus: saga.status,
          finalStatus: saga.status,
          action: 'skipped',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Recover a single saga based on its current status.
   */
  async recoverSaga(saga: SagaInstance): Promise<RecoveryResult> {
    // Look up the workflow
    const workflow = await this.workflowRepo.findByNameAndVersion(
      saga.workflowName,
      saga.workflowVersion
    );

    if (!workflow) {
      return {
        sagaId: saga.id,
        previousStatus: saga.status,
        finalStatus: saga.status,
        action: 'skipped',
        error: `Workflow not found: ${saga.workflowName} v${saga.workflowVersion}`,
      };
    }

    // Log recovery start
    await this.eventLogger?.recoveryStarted(saga.id, saga.status);

    // Get step logs to determine progress
    const stepLogs = await this.sagaRepo.getStepLogs(saga.id);

    let result: RecoveryResult;

    switch (saga.status) {
      case SagaStatus.EXECUTING:
        result = await this.recoverExecuting(saga, workflow, stepLogs);
        break;
      case SagaStatus.COMPENSATING:
      case SagaStatus.COMPENSATION_FAILED:
        result = await this.recoverCompensating(saga, workflow, stepLogs);
        break;
      default:
        result = {
          sagaId: saga.id,
          previousStatus: saga.status,
          finalStatus: saga.status,
          action: 'skipped',
        };
    }

    // Log recovery completion
    await this.eventLogger?.recoveryCompleted(saga.id, result.finalStatus);

    return result;
  }

  /**
   * Recover a saga that was in EXECUTING status.
   * Resumes forward execution from the last completed step.
   */
  private async recoverExecuting(
    saga: SagaInstance,
    workflow: WorkflowDefinition,
    stepLogs: StepLog[]
  ): Promise<RecoveryResult> {
    // Find completed step indices
    const completedStepIndices = this.getCompletedStepIndices(workflow, stepLogs);
    const nextStepIndex = completedStepIndices.length > 0
      ? Math.max(...completedStepIndices) + 1
      : 0;

    // Update the saga's step index to resume from
    await this.sagaRepo.updateStepIndex(saga.id, nextStepIndex);

    // Create a fresh engine and resume
    const compensationEngine = new CompensationEngine(this.sagaRepo);
    const sagaEngine = new SagaEngine(this.sagaRepo, async (s, w, indices) => {
      await compensationEngine.compensate(s, w, indices);
    });

    // Get updated saga with correct step index
    const updatedSaga = await this.sagaRepo.findById(saga.id);
    if (!updatedSaga) {
      return {
        sagaId: saga.id,
        previousStatus: saga.status,
        finalStatus: saga.status,
        action: 'skipped',
        error: 'Saga not found after update',
      };
    }

    const execResult = await sagaEngine.execute(updatedSaga, workflow);

    return {
      sagaId: saga.id,
      previousStatus: SagaStatus.EXECUTING,
      finalStatus: execResult.finalStatus,
      action: 'resumed_execution',
    };
  }

  /**
   * Recover a saga that was in COMPENSATING or COMPENSATION_FAILED status.
   * Resumes compensation for steps that haven't been compensated yet.
   */
  private async recoverCompensating(
    saga: SagaInstance,
    workflow: WorkflowDefinition,
    stepLogs: StepLog[]
  ): Promise<RecoveryResult> {
    // Find steps that completed their ACTION but haven't been compensated
    const completedStepIndices = this.getCompletedStepIndices(workflow, stepLogs);
    const compensatedStepNames = this.getCompensatedStepNames(stepLogs);

    // Filter out already-compensated steps
    const needsCompensation = completedStepIndices.filter((idx) => {
      const step = workflow.steps[idx];
      return step && !compensatedStepNames.has(step.name);
    });

    if (needsCompensation.length === 0) {
      // All steps already compensated — mark as rolled back
      await this.sagaRepo.updateStatus(saga.id, SagaStatus.ROLLED_BACK);
      return {
        sagaId: saga.id,
        previousStatus: saga.status,
        finalStatus: SagaStatus.ROLLED_BACK,
        action: 'resumed_compensation',
      };
    }

    // If saga is in COMPENSATION_FAILED, transition back to COMPENSATING
    if (saga.status === SagaStatus.COMPENSATION_FAILED) {
      await this.sagaRepo.updateStatus(saga.id, SagaStatus.COMPENSATING);
    }

    const compensationEngine = new CompensationEngine(this.sagaRepo);
    const compResult = await compensationEngine.compensate(
      { ...saga, status: SagaStatus.COMPENSATING },
      workflow,
      needsCompensation
    );

    return {
      sagaId: saga.id,
      previousStatus: saga.status,
      finalStatus: compResult.finalStatus,
      action: 'resumed_compensation',
    };
  }

  // ── Helper methods ────────────────────────────────────

  /**
   * Get indices of workflow steps that completed successfully.
   */
  private getCompletedStepIndices(
    workflow: WorkflowDefinition,
    stepLogs: StepLog[]
  ): number[] {
    const indices: number[] = [];

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step) continue;

      const hasSuccess = stepLogs.some(
        (log) =>
          log.stepName === step.name &&
          log.stepType === StepType.ACTION &&
          log.status === StepStatus.SUCCESS
      );

      if (hasSuccess) {
        indices.push(i);
      }
    }

    return indices;
  }

  /**
   * Get names of steps that have been successfully compensated.
   */
  private getCompensatedStepNames(stepLogs: StepLog[]): Set<string> {
    const compensated = new Set<string>();

    for (const log of stepLogs) {
      if (
        log.stepType === StepType.COMPENSATION &&
        log.status === StepStatus.COMPENSATED
      ) {
        compensated.add(log.stepName);
      }
    }

    return compensated;
  }
}
