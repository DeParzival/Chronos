// ============================================================
// Chronos — Compensation Engine
// ============================================================
// Executes compensating operations for previously successful
// steps when a later step fails.
//
// Compensation runs in REVERSE order — the most recently
// completed step is compensated first.
//
// Example:
//   Step 1: ✅ succeeded
//   Step 2: ✅ succeeded
//   Step 3: ❌ failed
//
//   Compensation order:
//     Step 2 compensation → Step 1 compensation
//
// Steps without a compensation URL are skipped.
// Each compensation result is persisted for audit trail.
// ============================================================

import {
  type SagaInstance,
  type WorkflowDefinition,
  SagaStatus,
  StepStatus,
  StepType,
} from '../types/index.js';
import { type SagaRepository } from '../persistence/SagaRepository.js';
import { executeStep } from './StepExecutor.js';

/**
 * Result of the compensation process.
 */
export interface CompensationResult {
  sagaId: string;
  finalStatus: SagaStatus;
  compensatedSteps: string[];
  failedCompensations: string[];
}

export class CompensationEngine {
  constructor(private readonly sagaRepo: SagaRepository) {}

  /**
   * Run compensations for a saga's completed steps.
   *
   * @param saga - The saga instance (must be in COMPENSATING status)
   * @param workflow - The workflow definition
   * @param completedStepIndices - Indices of successfully completed steps
   */
  async compensate(
    saga: SagaInstance,
    workflow: WorkflowDefinition,
    completedStepIndices: number[]
  ): Promise<CompensationResult> {
    const compensatedSteps: string[] = [];
    const failedCompensations: string[] = [];

    // Build the context for compensation calls
    const context: Record<string, unknown> = {
      ...saga.payload,
      ...saga.context,
    };

    // Reverse the completed steps — compensate most recent first
    const reversedIndices = [...completedStepIndices].reverse();

    for (const stepIndex of reversedIndices) {
      const step = workflow.steps[stepIndex];
      if (!step) continue;

      // Skip steps that don't have compensation defined
      if (!step.compensation) {
        await this.sagaRepo.logStep(
          saga.id,
          step.name,
          StepType.COMPENSATION,
          StepStatus.SKIPPED,
          { requestPayload: context }
        );
        continue;
      }

      // Log compensation started
      await this.sagaRepo.logStep(
        saga.id,
        step.name,
        StepType.COMPENSATION,
        StepStatus.COMPENSATING,
        { requestPayload: context }
      );

      // Execute the compensation
      const result = await executeStep(step.compensation, context);

      if (result.success) {
        // Log compensation success
        await this.sagaRepo.logStep(
          saga.id,
          step.name,
          StepType.COMPENSATION,
          StepStatus.COMPENSATED,
          {
            requestPayload: context,
            responsePayload: result.responseBody,
            executionTimeMs: result.executionTimeMs,
          }
        );
        compensatedSteps.push(step.name);
      } else {
        // Log compensation failure
        await this.sagaRepo.logStep(
          saga.id,
          step.name,
          StepType.COMPENSATION,
          StepStatus.COMPENSATION_FAILED,
          {
            requestPayload: context,
            responsePayload: result.responseBody,
            errorMessage: result.error,
            executionTimeMs: result.executionTimeMs,
          }
        );
        failedCompensations.push(step.name);
      }
    }

    // Determine final status
    let finalStatus: SagaStatus;
    if (failedCompensations.length > 0) {
      finalStatus = SagaStatus.COMPENSATION_FAILED;
      await this.sagaRepo.updateStatus(
        saga.id,
        SagaStatus.COMPENSATION_FAILED,
        `Compensation failed for steps: ${failedCompensations.join(', ')}`
      );
    } else {
      finalStatus = SagaStatus.ROLLED_BACK;
      await this.sagaRepo.updateStatus(saga.id, SagaStatus.ROLLED_BACK);
    }

    return {
      sagaId: saga.id,
      finalStatus,
      compensatedSteps,
      failedCompensations,
    };
  }
}
