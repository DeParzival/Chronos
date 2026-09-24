// ============================================================
// Chronos — Unit Tests: Chaos Engine
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChaosEngine,
  ChaosMode,
  createChaosScenario,
} from '../../src/testing/ChaosEngine.js';
import { type EndpointConfig } from '../../src/testing/MockService.js';

describe('ChaosEngine', () => {
  let chaos: ChaosEngine;

  const baseEndpoint: EndpointConfig = {
    path: '/charge',
    statusCode: 200,
    responseBody: { success: true },
    latencyMs: 0,
  };

  beforeEach(() => {
    chaos = new ChaosEngine();
  });

  // ── Enable/Disable ────────────────────────────────────

  it('should be disabled by default', () => {
    expect(chaos.enabled).toBe(false);
  });

  it('should pass through when disabled', () => {
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: '*',
      targetEndpoint: '*',
      errorStatusCode: 500,
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.statusCode).toBe(200); // unchanged
  });

  it('should apply rules when enabled', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: '*',
      targetEndpoint: '*',
      errorStatusCode: 503,
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.statusCode).toBe(503);
  });

  // ── Chaos Modes ───────────────────────────────────────

  it('should inject latency', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.LATENCY,
      targetService: '*',
      targetEndpoint: '*',
      latencyRange: { min: 100, max: 200 },
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.latencyMs).toBeGreaterThanOrEqual(100);
    expect(result.latencyMs).toBeLessThanOrEqual(200);
  });

  it('should force error responses', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: '*',
      targetEndpoint: '*',
      errorStatusCode: 422,
      errorMessage: 'Chaos!',
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.statusCode).toBe(422);
    expect(result.responseBody).toEqual({ error: 'Chaos!' });
  });

  it('should set partial failure probability', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.PARTIAL_FAILURE,
      targetService: '*',
      targetEndpoint: '*',
      failureProbability: 0.7,
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.failureProbability).toBe(0.7);
  });

  it('should simulate timeout with high latency', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.TIMEOUT,
      targetService: '*',
      targetEndpoint: '*',
      timeoutMs: 30000,
    });

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.latencyMs).toBe(30000);
  });

  // ── Rule Matching ─────────────────────────────────────

  it('should match specific service names', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: 'payment',
      targetEndpoint: '*',
      errorStatusCode: 500,
    });

    const paymentResult = chaos.applyToEndpoint('payment', baseEndpoint);
    const inventoryResult = chaos.applyToEndpoint('inventory', baseEndpoint);

    expect(paymentResult.statusCode).toBe(500);
    expect(inventoryResult.statusCode).toBe(200); // unaffected
  });

  it('should match specific endpoint paths', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: '*',
      targetEndpoint: '/charge',
      errorStatusCode: 500,
    });

    const chargeResult = chaos.applyToEndpoint('payment', baseEndpoint);
    const refundResult = chaos.applyToEndpoint('payment', { ...baseEndpoint, path: '/refund' });

    expect(chargeResult.statusCode).toBe(500);
    expect(refundResult.statusCode).toBe(200);
  });

  // ── Event Recording ───────────────────────────────────

  it('should record chaos events', () => {
    chaos.enable();
    chaos.addRule({
      mode: ChaosMode.ERROR,
      targetService: '*',
      targetEndpoint: '*',
      errorStatusCode: 500,
    });

    chaos.applyToEndpoint('payment', baseEndpoint);
    chaos.applyToEndpoint('inventory', baseEndpoint);

    const events = chaos.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.service).toBe('payment');
    expect(events[1]?.service).toBe('inventory');
  });

  it('should clear events', () => {
    chaos.enable();
    chaos.addRule({ mode: ChaosMode.ERROR, targetService: '*', targetEndpoint: '*', errorStatusCode: 500 });
    chaos.applyToEndpoint('payment', baseEndpoint);

    chaos.clearEvents();
    expect(chaos.getEvents()).toHaveLength(0);
  });

  // ── Rule Management ───────────────────────────────────

  it('should clear rules', () => {
    chaos.enable();
    chaos.addRule({ mode: ChaosMode.ERROR, targetService: '*', targetEndpoint: '*', errorStatusCode: 500 });
    chaos.clearRules();

    const result = chaos.applyToEndpoint('payment', baseEndpoint);
    expect(result.statusCode).toBe(200);
  });

  // ── Preset Scenarios ──────────────────────────────────

  it('should create network-jitter scenario', () => {
    const engine = createChaosScenario('network-jitter');
    expect(engine.enabled).toBe(true);

    const result = engine.applyToEndpoint('any', baseEndpoint);
    expect(result.latencyMs).toBeGreaterThanOrEqual(50);
  });

  it('should create service-outage scenario', () => {
    const engine = createChaosScenario('service-outage');
    const result = engine.applyToEndpoint('any', baseEndpoint);
    expect(result.statusCode).toBe(503);
  });

  it('should create partial-degradation scenario', () => {
    const engine = createChaosScenario('partial-degradation');
    const result = engine.applyToEndpoint('any', baseEndpoint);
    expect(result.failureProbability).toBe(0.3);
  });
});
