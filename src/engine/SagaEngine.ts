// ============================================================
// Chronos — Saga Execution Engine
// ============================================================
// The core orchestration engine that executes workflow steps
// sequentially. For each step:
//
//   1. Log STEP_STARTED
//   2. Make the HTTP call to the action URL
//   3. On success: log STEP_SUCCEEDED, advance to next step
//   4. On failure: log STEP_FAILED, trigger compensation
//
// Every result is persisted to PostgreSQL BEFORE advancing,
// enabling crash recovery.
// ============================================================

import {
  type SagaInstance,
  type WorkflowDefinition,
  SagaStatus,
  StepStatus,
  StepType,
} from '../types/index.js';
import { type SagaRepository } from '../persistence/SagaRepository.js';
import { executeStep, type StepExecutionResult } from './StepExecutor.js';

/**
 * Result of a full saga execution.
 */
export interface SagaExecutionResult {
  sagaId: string;
  finalStatus: SagaStatus;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
}

export class SagaEngine {
  constructor(
    private readonly sagaRepo: SagaRepository,
    private readonly onCompensate?: (saga: SagaInstance, workflow: WorkflowDefinition, completedStepIndices: number[]) => Promise<void>
  ) {}

  /**
   * Execute a saga instance through its workflow steps.
   *
   * Transitions: PENDING → EXECUTING → COMPLETED or COMPENSATING
   */
  async execute(
    saga: SagaInstance,
    workflow: WorkflowDefinition
  ): Promise<SagaExecutionResult> {
    const completedSteps: string[] = [];
    const completedStepIndices: number[] = [];

    // Transition to EXECUTING
    saga = await this.sagaRepo.updateStatus(saga.id, SagaStatus.EXECUTING);

    // Build the cumulative context (payload + step results)
    const context: Record<string, unknown> = {
      ...saga.payload,
      ...saga.context,
    };

    // Execute steps sequentially starting from current step index
    for (let i = saga.currentStepIndex; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step) continue;

      // Update current step index
      await this.sagaRepo.updateStepIndex(saga.id, i);

      // Log step started
      await this.sagaRepo.logStep(saga.id, step.name, StepType.ACTION, StepStatus.RUNNING, {
        requestPayload: context,
      });

      // Execute the step action
      const result = await executeStep(step.action, context);

      if (result.success) {
        // Log success
        await this.sagaRepo.logStep(saga.id, step.name, StepType.ACTION, StepStatus.SUCCESS, {
          requestPayload: context,
          responsePayload: result.responseBody,
          executionTimeMs: result.executionTimeMs,
        });

        // Add step result to context for subsequent steps
        if (result.responseBody) {
          context[step.name] = result.responseBody;
        }

        // Persist the accumulated context
        await this.sagaRepo.updateContext(saga.id, context);

        completedSteps.push(step.name);
        completedStepIndices.push(i);
      } else {
        // Log failure
        await this.sagaRepo.logStep(saga.id, step.name, StepType.ACTION, StepStatus.FAILED, {
          requestPayload: context,
          responsePayload: result.responseBody,
          errorMessage: result.error,
          executionTimeMs: result.executionTimeMs,
        });

        // Transition to COMPENSATING and trigger compensation
        await this.sagaRepo.updateStatus(saga.id, SagaStatus.COMPENSATING, result.error);

        // Trigger compensation for completed steps
        if (this.onCompensate && completedStepIndices.length > 0) {
          const freshSaga = await this.sagaRepo.findById(saga.id);
          if (freshSaga) {
            await this.onCompensate(freshSaga, workflow, completedStepIndices);
          }
        }

        return {
          sagaId: saga.id,
          finalStatus: SagaStatus.COMPENSATING,
          completedSteps,
          failedStep: step.name,
          error: result.error,
        };
      }
    }

    // All steps completed successfully
    await this.sagaRepo.updateStatus(saga.id, SagaStatus.COMPLETED);

    return {
      sagaId: saga.id,
      finalStatus: SagaStatus.COMPLETED,
      completedSteps,
    };
  }
}
