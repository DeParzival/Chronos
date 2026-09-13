// ============================================================
// Chronos — Unit Tests: Step Executor
// ============================================================
// Tests the HTTP step executor using a local Fastify mock server.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { executeStep } from '../../src/engine/StepExecutor.js';
import { type StepOperation } from '../../src/types/index.js';

describe('StepExecutor', () => {
  let mockServer: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    mockServer = Fastify({ logger: false, forceCloseConnections: true });

    // ── Success endpoint ────────────────────────────────
    mockServer.post('/success', async (_req, reply) => {
      return reply.status(200).send({ result: 'ok', transactionId: 'tx_123' });
    });

    // ── Failure endpoint ────────────────────────────────
    mockServer.post('/failure', async (_req, reply) => {
      return reply.status(500).send({ error: 'Internal Server Error' });
    });

    // ── Slow endpoint (for timeout testing) ─────────────
    mockServer.post('/slow', async (_req, reply) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return reply.status(200).send({ result: 'slow_ok' });
    });

    // ── Echo endpoint (returns what it receives) ────────
    mockServer.post('/echo', async (req, reply) => {
      return reply.status(200).send({ received: req.body });
    });

    // ── 400 Bad Request endpoint ────────────────────────
    mockServer.post('/bad-request', async (_req, reply) => {
      return reply.status(400).send({ error: 'Bad Request', details: 'Missing field' });
    });

    const address = await mockServer.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await mockServer.close();
  });

  it('should return success for a 200 response', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/success`,
      method: 'POST',
      timeoutMs: 5000,
    };

    const result = await executeStep(operation, { orderId: 'ord_1' });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toEqual({ result: 'ok', transactionId: 'tx_123' });
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('should return failure for a 500 response', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/failure`,
      method: 'POST',
      timeoutMs: 5000,
    };

    const result = await executeStep(operation, { orderId: 'ord_1' });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain('500');
  });

  it('should return failure for a 400 response', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/bad-request`,
      method: 'POST',
      timeoutMs: 5000,
    };

    const result = await executeStep(operation, {});

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.responseBody).toHaveProperty('error', 'Bad Request');
  });

  it('should timeout when the service is too slow', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/slow`,
      method: 'POST',
      timeoutMs: 500, // 500ms timeout, endpoint takes 3s
    };

    const result = await executeStep(operation, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(400);
  });

  it('should forward the payload as request body', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/echo`,
      method: 'POST',
      timeoutMs: 5000,
    };

    const payload = { orderId: 'ord_99', amount: 42.5 };
    const result = await executeStep(operation, payload);

    expect(result.success).toBe(true);
    expect(result.responseBody).toEqual({ received: payload });
  });

  it('should handle connection errors gracefully', async () => {
    const operation: StepOperation = {
      url: 'http://127.0.0.1:1', // nothing listening on port 1
      method: 'POST',
      timeoutMs: 2000,
    };

    const result = await executeStep(operation, {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should measure execution time', async () => {
    const operation: StepOperation = {
      url: `${baseUrl}/success`,
      method: 'POST',
      timeoutMs: 5000,
    };

    const result = await executeStep(operation, {});

    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.executionTimeMs).toBeLessThan(5000);
  });
});
