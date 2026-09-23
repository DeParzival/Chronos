// ============================================================
// Chronos — Unit Tests: Circuit Breaker
// ============================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
} from '../../src/reliability/CircuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker('payment-service', {
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      halfOpenMaxAttempts: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ─────────────────────────────────────

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should allow execution when CLOSED', () => {
    expect(breaker.canExecute()).toBe(true);
  });

  // ── CLOSED → OPEN ────────────────────────────────────

  it('should open after reaching failure threshold', () => {
    for (let i = 0; i < 3; i++) {
      breaker.onFailure();
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should not open before reaching threshold', () => {
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should reset failure count on success', () => {
    breaker.onFailure();
    breaker.onFailure();
    breaker.onSuccess(); // resets count
    breaker.onFailure(); // count is now 1, not 3
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  // ── OPEN behavior ────────────────────────────────────

  it('should reject execution when OPEN', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    expect(breaker.canExecute()).toBe(false);
  });

  it('should throw CircuitOpenError when executing while OPEN', async () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();

    await expect(
      breaker.execute(async () => 'result')
    ).rejects.toThrow(CircuitOpenError);
  });

  it('should include service name in CircuitOpenError', async () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();

    try {
      await breaker.execute(async () => 'result');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).serviceName).toBe('payment-service');
    }
  });

  // ── OPEN → HALF_OPEN ─────────────────────────────────

  it('should transition to HALF_OPEN after reset timeout', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(5000);
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('should NOT transition before reset timeout', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();

    vi.advanceTimersByTime(3000);
    expect(breaker.canExecute()).toBe(false);
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  // ── HALF_OPEN → CLOSED ───────────────────────────────

  it('should close on successful probe', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    vi.advanceTimersByTime(5000);
    breaker.canExecute(); // triggers transition to HALF_OPEN

    breaker.onSuccess();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  // ── HALF_OPEN → OPEN ─────────────────────────────────

  it('should re-open on failed probe', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    vi.advanceTimersByTime(5000);
    breaker.canExecute(); // triggers transition to HALF_OPEN

    breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  // ── execute() ─────────────────────────────────────────

  it('should return result on successful execute', async () => {
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.getStatus().successCount).toBe(1);
  });

  it('should record failure and rethrow on failed execute', async () => {
    await expect(
      breaker.execute(async () => { throw new Error('fail'); })
    ).rejects.toThrow('fail');

    expect(breaker.getStatus().failureCount).toBe(1);
  });

  // ── Status ────────────────────────────────────────────

  it('should report accurate status', () => {
    breaker.onSuccess();
    breaker.onFailure();

    const status = breaker.getStatus();
    expect(status.state).toBe(CircuitState.CLOSED);
    expect(status.successCount).toBe(1);
    expect(status.failureCount).toBe(1);
    expect(status.lastSuccessTime).not.toBeNull();
    expect(status.lastFailureTime).not.toBeNull();
  });

  // ── Manual reset ──────────────────────────────────────

  it('should reset to CLOSED and clear counters', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStatus().failureCount).toBe(0);
    expect(breaker.getStatus().successCount).toBe(0);
  });
});
