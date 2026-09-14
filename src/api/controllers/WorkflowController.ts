// ============================================================
// Chronos — Workflow Controller
// ============================================================
// Business logic for workflow management. Sits between the
// route layer (HTTP concerns) and the repository layer (DB).
// ============================================================

import { type WorkflowDefinition, type WorkflowStep } from '../../types/index.js';
import { type WorkflowRepository } from '../../persistence/WorkflowRepository.js';
import { validateWorkflow } from '../../workflow/validator.js';

export class WorkflowController {
  constructor(private readonly workflowRepo: WorkflowRepository) {}

  /**
   * Create a new workflow (or a new version if the name already exists).
   */
  async createWorkflow(
    name: string,
    steps: WorkflowStep[],
    description?: string
  ): Promise<{ workflow: WorkflowDefinition; warnings: string[] }> {
    // Run semantic validation
    const validation = validateWorkflow(name, steps);
    if (!validation.valid) {
      throw new WorkflowValidationError(validation.errors);
    }

    const workflow = await this.workflowRepo.create(name, steps, description);

    return { workflow, warnings: validation.warnings };
  }

  /**
   * Get the latest version of a workflow by name.
   */
  async getWorkflow(name: string): Promise<WorkflowDefinition> {
    const workflow = await this.workflowRepo.findByName(name);
    if (!workflow) {
      throw new WorkflowNotFoundError(name);
    }
    return workflow;
  }

  /**
   * List all workflows (latest version of each), paginated.
   */
  async listWorkflows(limit: number, offset: number): Promise<WorkflowDefinition[]> {
    return this.workflowRepo.list(limit, offset);
  }
}

/**
 * Thrown when workflow semantic validation fails.
 */
export class WorkflowValidationError extends Error {
  public readonly validationErrors: string[];

  constructor(errors: string[]) {
    super(`Workflow validation failed: ${errors.join('; ')}`);
    this.name = 'WorkflowValidationError';
    this.validationErrors = errors;
  }
}

/**
 * Thrown when a workflow is not found by name.
 */
export class WorkflowNotFoundError extends Error {
  constructor(name: string) {
    super(`Workflow "${name}" not found`);
    this.name = 'WorkflowNotFoundError';
  }
}
