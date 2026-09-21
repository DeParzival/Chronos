// ============================================================
// Chronos — Idempotency Key Generator
// ============================================================
// Generates deterministic, stable idempotency keys for saga
// step executions.
//
// Key format: saga-{sagaId}:{stepName}:{stepType}
//
// Because the key is derived from immutable saga properties,
// the SAME key is generated on retry. This lets downstream
// services detect duplicates and return cached results.
// ============================================================

import { type StepType } from '../types/index.js';

/**
 * Generate a deterministic idempotency key for a saga step.
 *
 * The key is stable across retries because it depends only on
 * the saga ID, step name, and operation type — none of which
 * change between attempts.
 */
export function generateIdempotencyKey(
  sagaId: string,
  stepName: string,
  stepType: StepType
): string {
  return `saga-${sagaId}:${stepName}:${stepType}`;
}

/**
 * Parse a previously generated idempotency key back into
 * its components.
 *
 * @returns The parsed components, or null if the key format is invalid
 */
export function parseIdempotencyKey(
  key: string
): { sagaId: string; stepName: string; stepType: string } | null {
  const match = key.match(/^saga-([^:]+):([^:]+):([^:]+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;

  return {
    sagaId: match[1],
    stepName: match[2],
    stepType: match[3],
  };
}
