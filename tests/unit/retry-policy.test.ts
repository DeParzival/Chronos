// ============================================================
// Chronos — Unit Tests: Retry Policy
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  calculateDelay,
  executeWithRetry,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from '../../src/reliability/RetryPolicy.js';
import { ErrorClassification } from '../../src/transport/HttpTransport.js';

describe('RetryPolicy', () => {
  // ── calculateDelay ────────────────────────────────────

  describe('calculateDelay', () => {
    const config: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitterMs: 0, // no jitter for deterministic tests
    };

    it('should use exponential backoff (1s, 2s, 4s, 8s)', () => {
      expect(calculateDelay(0, config)).toBe(1000);
      expect(calculateDelay(1, config)).toBe(2000);
      expect(calculateDelay(2, config)).toBe(4000);
      expect(calculateDelay(3, config)).toBe(8000);
    });

    it('should cap at maxDelayMs', () => {
      const smallCap = { ...config, maxDelayMs: 3000 };
      expect(calculateDelay(0, smallCap)).toBe(1000);
      expect(calculateDelay(1, smallCap)).toBe(2000);
      expect(calculateDelay(2, smallCap)).toBe(3000); // capped
      expect(calculateDelay(3, smallCap)).toBe(3000); // capped
    });

    it('should add jitter when configured', () => {
      const withJitter = { ...config, jitterMs: 500 };
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(calculateDelay(0, withJitter));
      }
      // With jitter, we should see varying delays
      // Base is 1000, jitter adds 0-500, so range is [1000, 1500]
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1500);
      }
    });
  });

  // ── executeWithRetry ──────────────────────────────────

  describe('executeWithRetry', () => {
    let mockServer: FastifyInstance;
    let baseUrl: string;
    let callCount: number;

    // Instant sleep for fast tests
    const instantSleep = async (_ms: number): Promise<void> => {};

    beforeAll(async () => {
      mockServer = Fastify({ logger: false, forceCloseConnections: true });
      mockServer.removeAllContentTypeParsers();
      mockServer.addContentTypeParser('*', (_req, _payload, done) => { done(null); });

      mockServer.all('/always-ok', async (_req, reply) => {
        callCount++;
        return reply.status(200).send({ result: 'ok' });
      });

      mockServer.all('/always-fail', async (_req, reply) => {
        callCount++;
        return reply.status(503).send({ error: 'down' });
      });

      mockServer.all('/client-error', async (_req, reply) => {
        callCount++;
        return reply.status(400).send({ error: 'bad request' });
      });

      // Fails twice, then succeeds
      mockServer.all('/fail-then-succeed', async (_req, reply) => {
        callCount++;
        if (callCount <= 2) {
          return reply.status(500).send({ error: 'temporary' });
        }
        return reply.status(200).send({ result: 'recovered' });
      });

      const address = await mockServer.listen({ port: 0, host: '127.0.0.1' });
      baseUrl = address;
    });

    afterAll(async () => {
      await mockServer.close();
    });

    it('should not retry on success', async () => {
      callCount = 0;
      const result = await executeWithRetry(
        { url: `${baseUrl}/always-ok`, method: 'POST', body: {} },
        DEFAULT_RETRY_CONFIG,
        instantSleep
      );

      expect(result.response.success).toBe(true);
      expect(result.totalAttempts).toBe(1);
      expect(result.wasRetried).toBe(false);
      expect(callCount).toBe(1);
    });

    it('should retry on server errors up to maxRetries', async () => {
      callCount = 0;
      const config: RetryConfig = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
      const result = await executeWithRetry(
        { url: `${baseUrl}/always-fail`, method: 'POST', body: {} },
        config,
        instantSleep
      );

      expect(result.response.success).toBe(false);
      expect(result.totalAttempts).toBe(3); // 1 initial + 2 retries
      expect(result.wasRetried).toBe(true);
      expect(callCount).toBe(3);
    });

    it('should NOT retry on client errors (4xx)', async () => {
      callCount = 0;
      const result = await executeWithRetry(
        { url: `${baseUrl}/client-error`, method: 'POST', body: {} },
        DEFAULT_RETRY_CONFIG,
        instantSleep
      );

      expect(result.response.success).toBe(false);
      expect(result.response.errorClassification).toBe(ErrorClassification.CLIENT_ERROR);
      expect(result.totalAttempts).toBe(1);
      expect(result.wasRetried).toBe(false);
      expect(callCount).toBe(1);
    });

    it('should succeed after transient failures', async () => {
      callCount = 0;
      const result = await executeWithRetry(
        { url: `${baseUrl}/fail-then-succeed`, method: 'POST', body: {} },
        DEFAULT_RETRY_CONFIG,
        instantSleep
      );

      expect(result.response.success).toBe(true);
      expect(result.totalAttempts).toBe(3); // 2 failures + 1 success
      expect(result.wasRetried).toBe(true);
      expect(result.response.body).toEqual({ result: 'recovered' });
    });

    it('should record retry delays', async () => {
      callCount = 0;
      const config: RetryConfig = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
      const result = await executeWithRetry(
        { url: `${baseUrl}/always-fail`, method: 'POST', body: {} },
        config,
        instantSleep
      );

      expect(result.retryDelays).toHaveLength(2);
      expect(result.retryDelays[0]).toBe(100);  // 100 × 2^0
      expect(result.retryDelays[1]).toBe(200);  // 100 × 2^1
    });

    it('should not retry when maxRetries is 0', async () => {
      callCount = 0;
      const config: RetryConfig = { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 };
      const result = await executeWithRetry(
        { url: `${baseUrl}/always-fail`, method: 'POST', body: {} },
        config,
        instantSleep
      );

      expect(result.totalAttempts).toBe(1);
      expect(result.wasRetried).toBe(false);
      expect(callCount).toBe(1);
    });
  });
});
