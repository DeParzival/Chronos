// ============================================================
// Chronos — Integration Tests
// ============================================================
// Tests that wire together multiple Chronos components:
//   - Mock microservices (payment, inventory, shipping)
//   - HTTP Transport with retry
//   - DAG engine for parallel execution
//   - Circuit breaker
//   - Compensation flow
//
// These tests validate the full execution pipeline without
// requiring PostgreSQL/Redis (mocked at boundaries).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MockService,
  createPaymentService,
  createInventoryService,
  createShippingService,
} from '../../src/testing/MockService.js';
import { httpTransport } from '../../src/transport/HttpTransport.js';
import { executeWithRetry, type RetryConfig } from '../../src/reliability/RetryPolicy.js';
import { CircuitBreaker, CircuitState, CircuitOpenError } from '../../src/reliability/CircuitBreaker.js';
import { buildDag, validateDag, computeLayers, executeDag, type DagNode, type DagStepResult } from '../../src/engine/DagEngine.js';
import { type WorkflowStep } from '../../src/types/index.js';

describe('Integration Tests', () => {
  let paymentSvc: MockService;
  let inventorySvc: MockService;
  let shippingSvc: MockService;

  beforeAll(async () => {
    paymentSvc = createPaymentService();
    inventorySvc = createInventoryService();
    shippingSvc = createShippingService();

    await paymentSvc.start();
    await inventorySvc.start();
    await shippingSvc.start();
  });

  afterAll(async () => {
    await paymentSvc.stop();
    await inventorySvc.stop();
    await shippingSvc.stop();
  });

  // ── Full Saga Flow (Happy Path) ───────────────────────

  describe('Happy Path - Sequential Workflow', () => {
    it('should execute all steps in order: payment → inventory → shipping', async () => {
      const steps = [
        { url: `${paymentSvc.url}/charge`, method: 'POST' as const },
        { url: `${inventorySvc.url}/reserve`, method: 'POST' as const },
        { url: `${shippingSvc.url}/schedule`, method: 'POST' as const },
      ];

      const results = [];
      for (const step of steps) {
        const result = await httpTransport({
          url: step.url,
          method: step.method,
          body: { orderId: 'ord_integration_1' },
        });
        results.push(result);
      }

      expect(results.every((r) => r.success)).toBe(true);
      expect(paymentSvc.requestCount).toBeGreaterThanOrEqual(1);
      expect(inventorySvc.requestCount).toBeGreaterThanOrEqual(1);
      expect(shippingSvc.requestCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Retry with Mock Services ──────────────────────────

  describe('Retry Integration', () => {
    it('should retry and succeed after transient failure', async () => {
      let callCount = 0;
      const transientSvc = new MockService({
        name: 'transient-svc',
        endpoints: [{
          path: '/flaky',
          handler: () => {
            callCount++;
            if (callCount <= 2) {
              return { statusCode: 503, body: { error: 'temporary' } };
            }
            return { statusCode: 200, body: { result: 'recovered' } };
          },
        }],
      });

      await transientSvc.start();
      try {
        const retryConfig: RetryConfig = {
          maxRetries: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitterMs: 0,
        };

        const result = await executeWithRetry(
          { url: `${transientSvc.url}/flaky`, method: 'POST', body: {} },
          retryConfig
        );

        expect(result.response.success).toBe(true);
        expect(result.totalAttempts).toBe(3);
        expect(result.wasRetried).toBe(true);
      } finally {
        await transientSvc.stop();
      }
    });
  });

  // ── DAG Parallel Execution ────────────────────────────

  describe('DAG Parallel Execution', () => {
    it('should execute independent steps in parallel then dependent steps', async () => {
      // payment and inventory run in parallel, then shipping depends on both
      const makeStep = (name: string, deps?: string[]): WorkflowStep & { dependsOn?: string[] } => ({
        name,
        action: { url: 'http://fake', method: 'POST' as const },
        ...(deps ? { dependsOn: deps } : {}),
      });

      const steps = [
        makeStep('charge-payment'),
        makeStep('reserve-inventory'),
        makeStep('schedule-shipping', ['charge-payment', 'reserve-inventory']),
      ];

      const nodes = buildDag(steps);
      const validation = validateDag(nodes);
      expect(validation.valid).toBe(true);

      const layers = computeLayers(nodes);
      expect(layers).toHaveLength(2);
      expect(layers[0]?.nodes).toHaveLength(2); // parallel
      expect(layers[1]?.nodes).toHaveLength(1); // sequential

      // Execute with real HTTP calls to mock services
      const serviceMap: Record<string, string> = {
        'charge-payment': `${paymentSvc.url}/charge`,
        'reserve-inventory': `${inventorySvc.url}/reserve`,
        'schedule-shipping': `${shippingSvc.url}/schedule`,
      };

      const result = await executeDag(layers, async (node: DagNode): Promise<DagStepResult> => {
        const start = Date.now();
        const url = serviceMap[node.step.name] ?? 'http://fake';
        const response = await httpTransport({
          url,
          method: 'POST',
          body: { orderId: 'dag_test' },
        });
        return {
          stepName: node.step.name,
          index: node.index,
          success: response.success,
          response: response.body,
          executionTimeMs: Date.now() - start,
        };
      });

      expect(result.success).toBe(true);
      expect(result.completedStepIndices.sort()).toEqual([0, 1, 2]);
    });
  });

  // ── Circuit Breaker with Real Calls ───────────────────

  describe('Circuit Breaker Integration', () => {
    it('should open circuit after failures and reject subsequent requests', async () => {
      const failingSvc = new MockService({
        name: 'failing-svc',
        endpoints: [{ path: '/fail', statusCode: 500, responseBody: { error: 'down' } }],
      });

      await failingSvc.start();
      try {
        const breaker = new CircuitBreaker('failing-svc', {
          failureThreshold: 3,
          resetTimeoutMs: 60000,
        });

        // Make 3 failing calls through the circuit breaker
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(async () => {
              const result = await httpTransport({
                url: `${failingSvc.url}/fail`,
                method: 'POST',
                body: {},
              });
              if (!result.success) throw new Error('Request failed');
              return result;
            });
          } catch {
            // Expected
          }
        }

        expect(breaker.getState()).toBe(CircuitState.OPEN);

        // Next call should be rejected without hitting the service
        const requestCountBefore = failingSvc.requestCount;
        try {
          await breaker.execute(async () => {
            await httpTransport({
              url: `${failingSvc.url}/fail`,
              method: 'POST',
              body: {},
            });
          });
        } catch (err) {
          expect(err).toBeInstanceOf(CircuitOpenError);
        }

        // Verify no additional request was made
        expect(failingSvc.requestCount).toBe(requestCountBefore);
      } finally {
        await failingSvc.stop();
      }
    });
  });

  // ── Compensation Flow ─────────────────────────────────

  describe('Compensation Flow', () => {
    it('should call compensation endpoints after a step failure', async () => {
      // Simulate: payment succeeds, inventory fails → refund payment
      const compensationSteps = [
        {
          action: `${paymentSvc.url}/charge`,
          compensation: `${paymentSvc.url}/refund`,
        },
        {
          action: `${inventorySvc.url}/reserve`,
          compensation: `${inventorySvc.url}/release`,
        },
      ];

      paymentSvc.clearRequests();
      inventorySvc.clearRequests();

      // Step 1: charge payment (success)
      const chargeResult = await httpTransport({
        url: compensationSteps[0]!.action,
        method: 'POST',
        body: { orderId: 'comp_test' },
      });
      expect(chargeResult.success).toBe(true);

      // Step 2: simulate inventory failure
      const failingSvc = new MockService({
        name: 'failing-inventory',
        endpoints: [{ path: '/reserve', statusCode: 500 }],
      });
      await failingSvc.start();

      const reserveResult = await httpTransport({
        url: `${failingSvc.url}/reserve`,
        method: 'POST',
        body: { orderId: 'comp_test' },
      });
      expect(reserveResult.success).toBe(false);

      await failingSvc.stop();

      // Compensate: refund payment
      const refundResult = await httpTransport({
        url: compensationSteps[0]!.compensation,
        method: 'POST',
        body: { orderId: 'comp_test', reason: 'inventory_failed' },
      });
      expect(refundResult.success).toBe(true);

      // Verify refund was called
      const refundRequests = paymentSvc.getRequestsTo('/refund');
      expect(refundRequests.length).toBeGreaterThanOrEqual(1);
    });
  });
});
