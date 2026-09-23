// ============================================================
// Chronos — DAG Workflow Engine
// ============================================================
// Extends the sequential execution model to support parallel
// execution of independent steps using a DAG (Directed Acyclic
// Graph) structure.
//
// Steps can declare dependencies via `dependsOn`. Steps with
// no unmet dependencies run concurrently via Promise.allSettled.
//
// Example:
//   step-a (no deps)     ─┐
//   step-b (no deps)     ─┼─> run in parallel
//   step-c (depends: a,b) ─> waits for both
// ============================================================

import { type WorkflowStep } from '../types/index.js';

/**
 * A node in the DAG representing a workflow step.
 */
export interface DagNode {
  step: WorkflowStep;
  index: number;
  dependsOn: string[];
}

/**
 * Execution layer — a group of steps that can run in parallel.
 */
export interface ExecutionLayer {
  /** Layer number (0-indexed) */
  layer: number;
  /** Steps in this layer (can all run concurrently) */
  nodes: DagNode[];
}

/**
 * Result of executing a single step in the DAG.
 */
export interface DagStepResult {
  stepName: string;
  index: number;
  success: boolean;
  response?: Record<string, unknown>;
  error?: string;
  executionTimeMs: number;
}

/**
 * Result of executing an entire DAG workflow.
 */
export interface DagExecutionResult {
  success: boolean;
  /** Results grouped by layer */
  layerResults: Array<{
    layer: number;
    results: DagStepResult[];
  }>;
  /** Steps that completed successfully (indices) */
  completedStepIndices: number[];
  /** The layer where execution failed (if any) */
  failedAtLayer?: number;
  totalExecutionTimeMs: number;
}

// ── DAG Analysis ───────────────────────────────────────────

/**
 * Build a DAG from workflow steps.
 * Steps without `dependsOn` are root nodes (layer 0).
 */
export function buildDag(steps: WorkflowStep[]): DagNode[] {
  return steps.map((step, index) => ({
    step,
    index,
    dependsOn: (step as WorkflowStep & { dependsOn?: string[] }).dependsOn ?? [],
  }));
}

/**
 * Validate that the DAG has no cycles and all dependencies exist.
 */
export function validateDag(nodes: DagNode[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepNames = new Set(nodes.map((n) => n.step.name));

  // Check all dependencies exist
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!stepNames.has(dep)) {
        errors.push(`Step "${node.step.name}" depends on unknown step "${dep}"`);
      }
      if (dep === node.step.name) {
        errors.push(`Step "${node.step.name}" cannot depend on itself`);
      }
    }
  }

  // Check for cycles using topological sort (Kahn's algorithm)
  if (errors.length === 0) {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.step.name, node.dependsOn.length);
      for (const dep of node.dependsOn) {
        const edges = adjacency.get(dep) ?? [];
        edges.push(node.step.name);
        adjacency.set(dep, edges);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    let processed = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (processed !== nodes.length) {
      errors.push('Workflow contains a cycle — steps cannot have circular dependencies');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute execution layers from the DAG.
 * Each layer contains steps whose dependencies are all in earlier layers.
 */
export function computeLayers(nodes: DagNode[]): ExecutionLayer[] {
  const layers: ExecutionLayer[] = [];
  const assigned = new Set<string>();
  const remaining = [...nodes];

  let layerNum = 0;

  while (remaining.length > 0) {
    const currentLayer: DagNode[] = [];

    for (let i = remaining.length - 1; i >= 0; i--) {
      const node = remaining[i]!;
      const depsResolved = node.dependsOn.every((dep) => assigned.has(dep));

      if (depsResolved) {
        currentLayer.push(node);
        remaining.splice(i, 1);
      }
    }

    if (currentLayer.length === 0) {
      // No progress — cycle detected (should be caught by validateDag)
      break;
    }

    layers.push({
      layer: layerNum,
      nodes: currentLayer.sort((a, b) => a.index - b.index),
    });

    for (const node of currentLayer) {
      assigned.add(node.step.name);
    }

    layerNum++;
  }

  return layers;
}

/**
 * Execute a DAG workflow.
 * Runs layers sequentially, steps within a layer in parallel.
 *
 * @param layers - Pre-computed execution layers
 * @param stepExecutor - Function to execute a single step
 */
export async function executeDag(
  layers: ExecutionLayer[],
  stepExecutor: (node: DagNode) => Promise<DagStepResult>
): Promise<DagExecutionResult> {
  const startTime = Date.now();
  const layerResults: DagExecutionResult['layerResults'] = [];
  const completedStepIndices: number[] = [];

  for (const layer of layers) {
    // Execute all steps in this layer concurrently
    const settled = await Promise.allSettled(
      layer.nodes.map((node) => stepExecutor(node))
    );

    const results: DagStepResult[] = settled.map((s, i) => {
      if (s.status === 'fulfilled') {
        return s.value;
      }
      return {
        stepName: layer.nodes[i]!.step.name,
        index: layer.nodes[i]!.index,
        success: false,
        error: s.reason instanceof Error ? s.reason.message : 'Unknown error',
        executionTimeMs: 0,
      };
    });

    layerResults.push({ layer: layer.layer, results });

    // Track completed steps
    for (const r of results) {
      if (r.success) {
        completedStepIndices.push(r.index);
      }
    }

    // If any step in this layer failed, stop execution
    const hasFailure = results.some((r) => !r.success);
    if (hasFailure) {
      return {
        success: false,
        layerResults,
        completedStepIndices,
        failedAtLayer: layer.layer,
        totalExecutionTimeMs: Date.now() - startTime,
      };
    }
  }

  return {
    success: true,
    layerResults,
    completedStepIndices,
    totalExecutionTimeMs: Date.now() - startTime,
  };
}
