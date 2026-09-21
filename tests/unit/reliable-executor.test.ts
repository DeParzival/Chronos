// ============================================================
// Chronos — Unit Tests: Reliable Step Executor
// ============================================================
// Tests the full reliability pipeline: idempotency + retry.
// Uses a mock HTTP server and a mock idempotency registry.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { executeReliableStep } from '../../src/reliability/ReliableExecutor.js';
import { StepType, type StepOperation } from '../../src/types/index.js';
import { type IdempotencyRecord } from '../../src/reliability/IdempotencyRegistry.js';

// ── Mock Idempotency Registry ───────────────────────────────

class MockIdempotencyRegistry {
  private cache = new Map<string, IdempotencyRecord>();

  async check(key: string): Promise<IdempotencyRecord | null> {
    return this.cache.get(key) ?? null;
  }

  async store(
    key: string,
    response: Record<string, unknown>,
    statusCode: number
  ): Promise<void> {
    this.cache.set(key, {
      key,
      response,
      statusCode,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
  }

  async cleanup(): Promise<number> { return 0; }
  async remove(key: string): Promise<boolean> { return this.cache.delete(key); }

  reset(): void { this.cache.clear(); }
  getAll(): Map<string, IdempotencyRecord> { return this.cache; }
}

describe('ReliableExecutor', () => {
  let mockServer: FastifyInstance;
  let baseUrl: string;
  let callCount: number;
  let mockRegistry: MockIdempotencyRegistry;

  beforeAll(async () => {
    mockServer = Fastify({ logger: false, forceCloseConnections: true });
    mockServer.removeAllContentTypeParsers();
    mockServer.addContentTypeParser('*', (_req, _payload, done) => { done(null); });

    mockServer.all('/success', async (_req, reply) => {
      callCount++;
      return reply.status(200).send({ result: 'ok', txId: `tx_${callCount}` });
    });

    mockServer.all('/always-fail', async (_req, reply) => {
      callCount++;
      return reply.status(500).send({ error: 'down' });
    });

    // Fails once, then succeeds
    mockServer.all('/transient', async (_req, reply) => {
      callCount++;
      if (callCount <= 1) {
        return reply.status(503).send({ error: 'temporary' });
      }
      return reply.status(200).send({ result: 'recovered' });
    });

    const address = await mockServer.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    callCount = 0;
    mockRegistry = new MockIdempotencyRegistry();
  });

  const makeOp = (path: string): StepOperation => ({
    url: `${baseUrl}${path}`,
    method: 'POST',
    timeoutMs: 5000,
  });

  it('should execute successfully and store in idempotency registry', async () => {
    const result = await executeReliableStep(
      makeOp('/success'),
      { orderId: 'ord_1' },
      'saga-123',
      'payment',
      StepType.ACTION,
      mockRegistry as unknown as import('../../src/reliability/IdempotencyRegistry.js').IdempotencyRegistry,
      { retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );

    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(result.totalAttempts).toBe(1);
    expect(result.idempotencyKey).toBe('saga-saga-123:payment:ACTION');

    // Verify it was stored
    const stored = mockRegistry.getAll();
    expect(stored.size).toBe(1);
  });

  it('should return cached result on second execution', async () => {
    const registry = mockRegistry as unknown as import('../../src/reliability/IdempotencyRegistry.js').IdempotencyRegistry;

    // First execution — hits the server
    const first = await executeReliableStep(
      makeOp('/success'),
      { orderId: 'ord_1' },
      'saga-456',
      'payment',
      StepType.ACTION,
      registry,
      { retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );
    expect(first.fromCache).toBe(false);
    expect(callCount).toBe(1);

    // Second execution — should return cached
    const second = await executeReliableStep(
      makeOp('/success'),
      { orderId: 'ord_1' },
      'saga-456',
      'payment',
      StepType.ACTION,
      registry,
      { retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );
    expect(second.fromCache).toBe(true);
    expect(second.totalAttempts).toBe(0);
    expect(callCount).toBe(1); // No additional server call
  });

  it('should retry on transient failures and succeed', async () => {
    const result = await executeReliableStep(
      makeOp('/transient'),
      {},
      'saga-789',
      'inventory',
      StepType.ACTION,
      null, // no idempotency
      { retryConfig: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, jitterMs: 0 } }
    );

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2); // 1 fail + 1 success
    expect(result.fromCache).toBe(false);
  });

  it('should work without idempotency registry (null)', async () => {
    const result = await executeReliableStep(
      makeOp('/success'),
      {},
      'saga-abc',
      'step-a',
      StepType.ACTION,
      null,
      { retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );

    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(false);
  });

  it('should work with idempotency disabled', async () => {
    const registry = mockRegistry as unknown as import('../../src/reliability/IdempotencyRegistry.js').IdempotencyRegistry;

    const result = await executeReliableStep(
      makeOp('/success'),
      {},
      'saga-def',
      'step-b',
      StepType.ACTION,
      registry,
      { enableIdempotency: false, retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );

    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(false);
    // Registry should be empty since idempotency was disabled
    expect(mockRegistry.getAll().size).toBe(0);
  });

  it('should include the idempotency key in the result', async () => {
    const result = await executeReliableStep(
      makeOp('/success'),
      {},
      'my-saga',
      'charge',
      StepType.COMPENSATION,
      null,
      { retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 } }
    );

    expect(result.idempotencyKey).toBe('saga-my-saga:charge:COMPENSATION');
  });
});
