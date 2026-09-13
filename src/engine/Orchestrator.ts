// ============================================================
// Chronos — Orchestrator
// ============================================================
// High-level orchestrator that wires together the SagaEngine
// and CompensationEngine. This is the main entry point for
// starting and managing saga executions.
// ============================================================

import { type WorkflowDefinition, SagaStatus } from '../types/index.js';
import { type SagaRepository } from '../persistence/SagaRepository.js';
import { type WorkflowRepository } from '../persistence/WorkflowRepository.js';
import { SagaEngine, type SagaExecutionResult } from './SagaEngine.js';
import { CompensationEngine } from './CompensationEngine.js';

export class Orchestrator {
  private readonly sagaEngine: SagaEngine;
  private readonly compensationEngine: CompensationEngine;

  constructor(
    private readonly sagaRepo: SagaRepository,
    private readonly workflowRepo: WorkflowRepository
  ) {
    this.compensationEngine = new CompensationEngine(sagaRepo);

    // Wire the SagaEngine's onCompensate callback to the CompensationEngine
    this.sagaEngine = new SagaEngine(sagaRepo, async (saga, workflow, completedStepIndices) => {
      await this.compensationEngine.compensate(saga, workflow, completedStepIndices);
    });
  }

  /**
   * Start a new saga execution.
   *
   * 1. Looks up the workflow by name
   * 2. Creates a saga instance in PENDING status
   * 3. Executes the workflow steps
   * 4. If a step fails, automatically compensates
   */
  async startSaga(
    workflowName: string,
    payload: Record<string, unknown>
  ): Promise<SagaExecutionResult> {
    // Look up the workflow
    const workflow = await this.workflowRepo.findByName(workflowName);
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowName);
    }

    // Create the saga instance
    const saga = await this.sagaRepo.create(workflowName, workflow.version, payload);

    // Execute the saga
    return this.sagaEngine.execute(saga, workflow);
  }

  /**
   * Manually trigger compensation for a saga.
   * The saga must be in EXECUTING or COMPENSATION_FAILED status.
   */
  async compensateSaga(sagaId: string): Promise<void> {
    const saga = await this.sagaRepo.findById(sagaId);
    if (!saga) {
      throw new Error(`Saga not found: ${sagaId}`);
    }

    if (saga.status !== SagaStatus.EXECUTING && saga.status !== SagaStatus.COMPENSATION_FAILED) {
      throw new Error(
        `Cannot compensate saga in ${saga.status} status. ` +
        `Must be EXECUTING or COMPENSATION_FAILED.`
      );
    }

    const workflow = await this.workflowRepo.findByNameAndVersion(
      saga.workflowName,
      saga.workflowVersion
    );
    if (!workflow) {
      throw new Error(`Workflow not found: ${saga.workflowName} v${saga.workflowVersion}`);
    }

    // Determine completed steps from step logs
    const stepLogs = await this.sagaRepo.getStepLogs(sagaId);
    const completedStepIndices: number[] = [];

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step) continue;

      const successLog = stepLogs.find(
        (log) => log.stepName === step.name && log.stepType === 'ACTION' && log.status === 'SUCCESS'
      );
      if (successLog) {
        completedStepIndices.push(i);
      }
    }

    // If saga is in COMPENSATION_FAILED, transition back to COMPENSATING
    if (saga.status === SagaStatus.COMPENSATION_FAILED) {
      await this.sagaRepo.updateStatus(sagaId, SagaStatus.COMPENSATING);
    }

    await this.compensationEngine.compensate(
      { ...saga, status: SagaStatus.COMPENSATING },
      workflow,
      completedStepIndices
    );
  }
}

/**
 * Error thrown when a workflow is not found.
 */
export class WorkflowNotFoundError extends Error {
  constructor(workflowName: string) {
    super(`Workflow not found: "${workflowName}". Register it first via POST /workflows.`);
    this.name = 'WorkflowNotFoundError';
  }
}
