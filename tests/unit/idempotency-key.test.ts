// ============================================================
// Chronos — Unit Tests: Idempotency Key
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  generateIdempotencyKey,
  parseIdempotencyKey,
} from '../../src/reliability/IdempotencyKey.js';
import { StepType } from '../../src/types/index.js';

describe('IdempotencyKey', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate a key in the correct format', () => {
      const key = generateIdempotencyKey('abc-123', 'charge-payment', StepType.ACTION);
      expect(key).toBe('saga-abc-123:charge-payment:ACTION');
    });

    it('should generate different keys for ACTION vs COMPENSATION', () => {
      const actionKey = generateIdempotencyKey('abc-123', 'charge-payment', StepType.ACTION);
      const compKey = generateIdempotencyKey('abc-123', 'charge-payment', StepType.COMPENSATION);

      expect(actionKey).not.toBe(compKey);
      expect(actionKey).toContain('ACTION');
      expect(compKey).toContain('COMPENSATION');
    });

    it('should generate the same key on repeated calls (deterministic)', () => {
      const key1 = generateIdempotencyKey('saga-xyz', 'step-a', StepType.ACTION);
      const key2 = generateIdempotencyKey('saga-xyz', 'step-a', StepType.ACTION);
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different sagas', () => {
      const key1 = generateIdempotencyKey('saga-1', 'payment', StepType.ACTION);
      const key2 = generateIdempotencyKey('saga-2', 'payment', StepType.ACTION);
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different steps', () => {
      const key1 = generateIdempotencyKey('saga-1', 'payment', StepType.ACTION);
      const key2 = generateIdempotencyKey('saga-1', 'inventory', StepType.ACTION);
      expect(key1).not.toBe(key2);
    });
  });

  describe('parseIdempotencyKey', () => {
    it('should parse a valid key', () => {
      const parsed = parseIdempotencyKey('saga-abc-123:charge-payment:ACTION');

      expect(parsed).not.toBeNull();
      expect(parsed!.sagaId).toBe('abc-123');
      expect(parsed!.stepName).toBe('charge-payment');
      expect(parsed!.stepType).toBe('ACTION');
    });

    it('should return null for an invalid key format', () => {
      expect(parseIdempotencyKey('invalid')).toBeNull();
      expect(parseIdempotencyKey('')).toBeNull();
      expect(parseIdempotencyKey('saga-::')).toBeNull();
    });

    it('should round-trip: generate → parse', () => {
      const key = generateIdempotencyKey('uuid-456', 'reserve-stock', StepType.COMPENSATION);
      const parsed = parseIdempotencyKey(key);

      expect(parsed).not.toBeNull();
      expect(parsed!.sagaId).toBe('uuid-456');
      expect(parsed!.stepName).toBe('reserve-stock');
      expect(parsed!.stepType).toBe('COMPENSATION');
    });
  });
});
