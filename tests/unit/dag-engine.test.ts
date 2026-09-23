// ============================================================
// Chronos — Unit Tests: DAG Workflow Engine
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildDag,
  validateDag,
  computeLayers,
  executeDag,
  type DagNode,
  type DagStepResult,
} from '../../src/engine/DagEngine.js';
import { type WorkflowStep } from '../../src/types/index.js';

const makeStep = (name: string, dependsOn?: string[]): WorkflowStep & { dependsOn?: string[] } => ({
  name,
  action: { url: `http://fake/${name}`, method: 'POST' as const },
  ...(dependsOn ? { dependsOn } : {}),
});

describe('DagEngine', () => {
  // ── buildDag ──────────────────────────────────────────

  describe('buildDag', () => {
    it('should create nodes from steps', () => {
      const steps = [makeStep('a'), makeStep('b', ['a'])];
      const nodes = buildDag(steps);

      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.dependsOn).toEqual([]);
      expect(nodes[1]?.dependsOn).toEqual(['a']);
    });
  });

  // ── validateDag ───────────────────────────────────────

  describe('validateDag', () => {
    it('should validate a valid DAG', () => {
      const nodes = buildDag([makeStep('a'), makeStep('b', ['a']), makeStep('c', ['a', 'b'])]);
      const result = validateDag(nodes);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing dependencies', () => {
      const nodes = buildDag([makeStep('a', ['nonexistent'])]);
      const result = validateDag(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('unknown step');
    });

    it('should reject self-dependencies', () => {
      const nodes = buildDag([makeStep('a', ['a'])]);
      const result = validateDag(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cannot depend on itself');
    });

    it('should reject cycles', () => {
      const nodes = buildDag([makeStep('a', ['b']), makeStep('b', ['a'])]);
      const result = validateDag(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cycle');
    });

    it('should accept steps with no dependencies', () => {
      const nodes = buildDag([makeStep('a'), makeStep('b'), makeStep('c')]);
      const result = validateDag(nodes);
      expect(result.valid).toBe(true);
    });
  });

  // ── computeLayers ─────────────────────────────────────

  describe('computeLayers', () => {
    it('should put independent steps in the same layer', () => {
      const nodes = buildDag([makeStep('a'), makeStep('b'), makeStep('c')]);
      const layers = computeLayers(nodes);

      expect(layers).toHaveLength(1);
      expect(layers[0]?.nodes).toHaveLength(3);
    });

    it('should order dependent steps into later layers', () => {
      const nodes = buildDag([
        makeStep('a'),
        makeStep('b'),
        makeStep('c', ['a', 'b']),
      ]);
      const layers = computeLayers(nodes);

      expect(layers).toHaveLength(2);
      expect(layers[0]?.nodes.map((n) => n.step.name)).toEqual(['a', 'b']);
      expect(layers[1]?.nodes.map((n) => n.step.name)).toEqual(['c']);
    });

    it('should handle a chain of dependencies', () => {
      const nodes = buildDag([
        makeStep('a'),
        makeStep('b', ['a']),
        makeStep('c', ['b']),
      ]);
      const layers = computeLayers(nodes);

      expect(layers).toHaveLength(3);
      expect(layers[0]?.nodes[0]?.step.name).toBe('a');
      expect(layers[1]?.nodes[0]?.step.name).toBe('b');
      expect(layers[2]?.nodes[0]?.step.name).toBe('c');
    });

    it('should handle diamond dependencies', () => {
      // a → b, a → c, b+c → d
      const nodes = buildDag([
        makeStep('a'),
        makeStep('b', ['a']),
        makeStep('c', ['a']),
        makeStep('d', ['b', 'c']),
      ]);
      const layers = computeLayers(nodes);

      expect(layers).toHaveLength(3);
      expect(layers[0]?.nodes.map((n) => n.step.name)).toEqual(['a']);
      expect(layers[1]?.nodes.map((n) => n.step.name).sort()).toEqual(['b', 'c']);
      expect(layers[2]?.nodes.map((n) => n.step.name)).toEqual(['d']);
    });
  });

  // ── executeDag ────────────────────────────────────────

  describe('executeDag', () => {
    const makeExecutor = (failSteps: string[] = []) => {
      const executionOrder: string[] = [];
      return {
        executionOrder,
        executor: async (node: DagNode): Promise<DagStepResult> => {
          executionOrder.push(node.step.name);
          const shouldFail = failSteps.includes(node.step.name);
          return {
            stepName: node.step.name,
            index: node.index,
            success: !shouldFail,
            error: shouldFail ? `${node.step.name} failed` : undefined,
            executionTimeMs: 10,
          };
        },
      };
    };

    it('should execute all steps successfully', async () => {
      const nodes = buildDag([makeStep('a'), makeStep('b', ['a'])]);
      const layers = computeLayers(nodes);
      const { executor } = makeExecutor();

      const result = await executeDag(layers, executor);

      expect(result.success).toBe(true);
      expect(result.completedStepIndices).toEqual([0, 1]);
      expect(result.layerResults).toHaveLength(2);
    });

    it('should stop at the failed layer', async () => {
      const nodes = buildDag([
        makeStep('a'),
        makeStep('b', ['a']),
        makeStep('c', ['b']),
      ]);
      const layers = computeLayers(nodes);
      const { executor } = makeExecutor(['b']);

      const result = await executeDag(layers, executor);

      expect(result.success).toBe(false);
      expect(result.failedAtLayer).toBe(1);
      expect(result.completedStepIndices).toEqual([0]); // only 'a' completed
    });

    it('should run parallel steps concurrently', async () => {
      const nodes = buildDag([makeStep('a'), makeStep('b'), makeStep('c')]);
      const layers = computeLayers(nodes);
      const { executor, executionOrder } = makeExecutor();

      const result = await executeDag(layers, executor);

      expect(result.success).toBe(true);
      expect(executionOrder.sort()).toEqual(['a', 'b', 'c']); // all ran
      expect(result.layerResults).toHaveLength(1); // single layer
    });

    it('should record completed indices even on failure', async () => {
      // a and b run in parallel, b fails
      const nodes = buildDag([makeStep('a'), makeStep('b')]);
      const layers = computeLayers(nodes);
      const { executor } = makeExecutor(['b']);

      const result = await executeDag(layers, executor);

      expect(result.success).toBe(false);
      expect(result.completedStepIndices).toEqual([0]); // 'a' completed
    });
  });
});
