// ============================================================
// Chronos — Unit Tests: Saga State Machine
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  transition,
  getValidNextStates,
  isTerminalState,
  isActiveState,
  InvalidTransitionError,
} from '../../src/engine/StateMachine.js';
import { SagaStatus } from '../../src/types/index.js';

describe('StateMachine', () => {
  // ── Valid transitions ─────────────────────────────────────

  describe('valid transitions', () => {
    const validCases: [SagaStatus, SagaStatus][] = [
      [SagaStatus.PENDING, SagaStatus.EXECUTING],
      [SagaStatus.EXECUTING, SagaStatus.COMPLETED],
      [SagaStatus.EXECUTING, SagaStatus.COMPENSATING],
      [SagaStatus.COMPENSATING, SagaStatus.ROLLED_BACK],
      [SagaStatus.COMPENSATING, SagaStatus.COMPENSATION_FAILED],
      [SagaStatus.COMPENSATION_FAILED, SagaStatus.COMPENSATING],
    ];

    it.each(validCases)(
      'should allow %s → %s',
      (from, to) => {
        expect(isValidTransition(from, to)).toBe(true);
        expect(transition(from, to)).toBe(to);
      }
    );
  });

  // ── Invalid transitions ───────────────────────────────────

  describe('invalid transitions', () => {
    const invalidCases: [SagaStatus, SagaStatus][] = [
      // Can't go backwards
      [SagaStatus.EXECUTING, SagaStatus.PENDING],
      // Can't skip states
      [SagaStatus.PENDING, SagaStatus.COMPLETED],
      [SagaStatus.PENDING, SagaStatus.COMPENSATING],
      [SagaStatus.PENDING, SagaStatus.ROLLED_BACK],
      // Terminal states can't transition
      [SagaStatus.COMPLETED, SagaStatus.EXECUTING],
      [SagaStatus.COMPLETED, SagaStatus.COMPENSATING],
      [SagaStatus.ROLLED_BACK, SagaStatus.EXECUTING],
      [SagaStatus.ROLLED_BACK, SagaStatus.COMPENSATING],
      // Can't go from COMPENSATING back to EXECUTING
      [SagaStatus.COMPENSATING, SagaStatus.EXECUTING],
      // Self-transitions are not allowed
      [SagaStatus.PENDING, SagaStatus.PENDING],
      [SagaStatus.EXECUTING, SagaStatus.EXECUTING],
    ];

    it.each(invalidCases)(
      'should reject %s → %s',
      (from, to) => {
        expect(isValidTransition(from, to)).toBe(false);
        expect(() => transition(from, to)).toThrow(InvalidTransitionError);
      }
    );
  });

  // ── InvalidTransitionError ────────────────────────────────

  describe('InvalidTransitionError', () => {
    it('should include from and to states in the error', () => {
      try {
        transition(SagaStatus.COMPLETED, SagaStatus.EXECUTING);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const error = err as InvalidTransitionError;
        expect(error.from).toBe(SagaStatus.COMPLETED);
        expect(error.to).toBe(SagaStatus.EXECUTING);
        expect(error.message).toContain('COMPLETED');
        expect(error.message).toContain('EXECUTING');
        expect(error.message).toContain('terminal state');
      }
    });

    it('should list valid transitions in the error message', () => {
      try {
        transition(SagaStatus.EXECUTING, SagaStatus.PENDING);
      } catch (err) {
        const error = err as InvalidTransitionError;
        expect(error.message).toContain('COMPLETED');
        expect(error.message).toContain('COMPENSATING');
      }
    });
  });

  // ── getValidNextStates ────────────────────────────────────

  describe('getValidNextStates', () => {
    it('should return [EXECUTING] for PENDING', () => {
      const next = getValidNextStates(SagaStatus.PENDING);
      expect(next).toEqual([SagaStatus.EXECUTING]);
    });

    it('should return [COMPLETED, COMPENSATING] for EXECUTING', () => {
      const next = getValidNextStates(SagaStatus.EXECUTING);
      expect(next).toContain(SagaStatus.COMPLETED);
      expect(next).toContain(SagaStatus.COMPENSATING);
      expect(next).toHaveLength(2);
    });

    it('should return empty array for COMPLETED', () => {
      const next = getValidNextStates(SagaStatus.COMPLETED);
      expect(next).toEqual([]);
    });

    it('should return empty array for ROLLED_BACK', () => {
      const next = getValidNextStates(SagaStatus.ROLLED_BACK);
      expect(next).toEqual([]);
    });

    it('should return [COMPENSATING] for COMPENSATION_FAILED', () => {
      const next = getValidNextStates(SagaStatus.COMPENSATION_FAILED);
      expect(next).toEqual([SagaStatus.COMPENSATING]);
    });
  });

  // ── Terminal / Active state checks ────────────────────────

  describe('isTerminalState', () => {
    it('should return true for COMPLETED', () => {
      expect(isTerminalState(SagaStatus.COMPLETED)).toBe(true);
    });

    it('should return true for ROLLED_BACK', () => {
      expect(isTerminalState(SagaStatus.ROLLED_BACK)).toBe(true);
    });

    it('should return false for PENDING', () => {
      expect(isTerminalState(SagaStatus.PENDING)).toBe(false);
    });

    it('should return false for EXECUTING', () => {
      expect(isTerminalState(SagaStatus.EXECUTING)).toBe(false);
    });

    it('should return false for COMPENSATING', () => {
      expect(isTerminalState(SagaStatus.COMPENSATING)).toBe(false);
    });

    it('should return false for COMPENSATION_FAILED', () => {
      expect(isTerminalState(SagaStatus.COMPENSATION_FAILED)).toBe(false);
    });
  });

  describe('isActiveState', () => {
    it('should be the inverse of isTerminalState', () => {
      for (const status of Object.values(SagaStatus)) {
        expect(isActiveState(status)).toBe(!isTerminalState(status));
      }
    });
  });
});
