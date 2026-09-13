// ============================================================
// Chronos — Workflow Validator
// ============================================================
// Validates workflow definitions beyond what Zod schema checks.
// Performs semantic validation like:
// - Unique step names within a workflow
// - Compensation URL presence warnings
// - Step dependency checks (for future DAG support)
// ============================================================

import { type WorkflowStep } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a workflow's steps for semantic correctness.
 *
 * Zod handles structural validation (types, required fields).
 * This function handles business-logic validation.
 */
export function validateWorkflow(
  name: string,
  steps: WorkflowStep[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Check for duplicate step names ────────────────────
  const stepNames = new Set<string>();
  for (const step of steps) {
    if (stepNames.has(step.name)) {
      errors.push(`Duplicate step name: "${step.name}". Step names must be unique within a workflow.`);
    }
    stepNames.add(step.name);
  }

  // ── Check for steps without compensation ──────────────
  for (const step of steps) {
    if (!step.compensation) {
      warnings.push(
        `Step "${step.name}" has no compensation defined. ` +
        `If this step succeeds and a later step fails, it cannot be undone.`
      );
    }
  }

  // ── Warn if the last step has compensation ────────────
  // (The last step's compensation is rarely needed since if it
  //  fails, compensation starts from the step before it)
  const lastStep = steps[steps.length - 1];
  if (lastStep && !lastStep.compensation && steps.length > 1) {
    // Already warned above, no additional warning needed
  }

  // ── Validate workflow name length ─────────────────────
  if (name.length > 255) {
    errors.push('Workflow name cannot exceed 255 characters.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
