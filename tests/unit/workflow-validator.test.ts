// ============================================================
// Chronos — Unit Tests: Workflow Validator
// ============================================================

import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../src/workflow/validator.js';
import { type WorkflowStep } from '../../src/types/index.js';

const makeStep = (name: string, hasCompensation = true): WorkflowStep => ({
  name,
  action: {
    url: `http://service/${name}`,
    method: 'POST',
    timeoutMs: 5000,
  },
  ...(hasCompensation
    ? {
        compensation: {
          url: `http://service/${name}/compensate`,
          method: 'POST',
          timeoutMs: 5000,
        },
      }
    : {}),
});

describe('Workflow Validator', () => {
  it('should pass for a valid workflow with unique steps', () => {
    const steps = [makeStep('step-a'), makeStep('step-b'), makeStep('step-c')];
    const result = validateWorkflow('test-workflow', steps);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when step names are duplicated', () => {
    const steps = [makeStep('step-a'), makeStep('step-b'), makeStep('step-a')];
    const result = validateWorkflow('test-workflow', steps);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Duplicate step name');
    expect(result.errors[0]).toContain('step-a');
  });

  it('should detect multiple duplicate step names', () => {
    const steps = [
      makeStep('step-a'),
      makeStep('step-a'),
      makeStep('step-b'),
      makeStep('step-b'),
    ];
    const result = validateWorkflow('test-workflow', steps);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('should warn when a step has no compensation', () => {
    const steps = [makeStep('step-a', true), makeStep('step-b', false)];
    const result = validateWorkflow('test-workflow', steps);

    expect(result.valid).toBe(true); // warnings don't fail validation
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('step-b');
    expect(result.warnings[0]).toContain('no compensation');
  });

  it('should return no warnings when all steps have compensations', () => {
    const steps = [makeStep('step-a'), makeStep('step-b')];
    const result = validateWorkflow('test-workflow', steps);

    expect(result.warnings).toHaveLength(0);
  });

  it('should fail for excessively long workflow names', () => {
    const longName = 'a'.repeat(256);
    const steps = [makeStep('step-a')];
    const result = validateWorkflow(longName, steps);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('255 characters');
  });
});
