// ============================================================
// Chronos — Saga State Machine
// ============================================================
// Enforces valid state transitions for saga instances.
//
// A saga follows this lifecycle:
//
//   PENDING → EXECUTING → COMPLETED
//                       → COMPENSATING → ROLLED_BACK
//                                      → COMPENSATION_FAILED
//   COMPENSATION_FAILED → COMPENSATING  (retry)
//
// Any transition not in the valid set is rejected with an error.
// This prevents bugs from silently corrupting saga state.
// ============================================================

import { SagaStatus } from '../types/index.js';

/**
 * Map of valid state transitions.
 *
 * Key: current status
 * Value: set of statuses that can be transitioned TO
 */
const VALID_TRANSITIONS: ReadonlyMap<SagaStatus, ReadonlySet<SagaStatus>> = new Map([
  [SagaStatus.PENDING, new Set([SagaStatus.EXECUTING])],
  [SagaStatus.EXECUTING, new Set([SagaStatus.COMPLETED, SagaStatus.COMPENSATING])],
  [SagaStatus.COMPENSATING, new Set([SagaStatus.ROLLED_BACK, SagaStatus.COMPENSATION_FAILED])],
  [SagaStatus.COMPENSATION_FAILED, new Set([SagaStatus.COMPENSATING])],
  // Terminal states — no transitions out
  [SagaStatus.COMPLETED, new Set()],
  [SagaStatus.ROLLED_BACK, new Set()],
]);

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: SagaStatus, to: SagaStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Attempt a state transition. Throws if the transition is invalid.
 *
 * @returns The new status (same as `to`)
 * @throws Error if the transition is not allowed
 */
export function transition(from: SagaStatus, to: SagaStatus): SagaStatus {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  return to;
}

/**
 * Get all valid next states from the current state.
 */
export function getValidNextStates(from: SagaStatus): SagaStatus[] {
  const allowed = VALID_TRANSITIONS.get(from);
  if (!allowed) return [];
  return [...allowed];
}

/**
 * Check if a status is a terminal (final) state.
 * A terminal state has no valid outgoing transitions.
 */
export function isTerminalState(status: SagaStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(status);
  if (!allowed) return true;
  return allowed.size === 0;
}

/**
 * Check if a status indicates the saga is still active
 * (i.e., not in a terminal state).
 */
export function isActiveState(status: SagaStatus): boolean {
  return !isTerminalState(status);
}

/**
 * Custom error for invalid state transitions.
 * Provides clear diagnostic information.
 */
export class InvalidTransitionError extends Error {
  public readonly from: SagaStatus;
  public readonly to: SagaStatus;

  constructor(from: SagaStatus, to: SagaStatus) {
    const validNext = getValidNextStates(from);
    const validStr = validNext.length > 0 ? validNext.join(', ') : 'none (terminal state)';

    super(
      `Invalid saga state transition: ${from} → ${to}. ` +
      `Valid transitions from ${from}: ${validStr}`
    );

    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}
