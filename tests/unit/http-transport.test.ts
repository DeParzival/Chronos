// ============================================================
// Chronos — Unit Tests: HTTP Transport Client
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  httpTransport,
  ErrorClassification,
  isRetryableError,
} from '../../src/transport/HttpTransport.js';

describe('HttpTransport', () => {
  let mockServer: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    mockServer = Fastify({ logger: false, forceCloseConnections: true });

    // Disable Fastify's default content-type parsing to avoid 400s
    mockServer.removeAllContentTypeParsers();
    mockServer.addContentTypeParser('*', (_req, _payload, done) => { done(null); });

    mockServer.all('/ok', async (_req, reply) => {
      return reply.status(200).send({ result: 'success' });
    });

    mockServer.all('/server-error', async (_req, reply) => {
      return reply.status(503).send({ error: 'Service Unavailable' });
    });

    mockServer.all('/client-error', async (_req, reply) => {
      return reply.status(422).send({ error: 'Unprocessable Entity' });
    });

    mockServer.all('/slow', async (_req, reply) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return reply.status(200).send({ result: 'slow' });
    });

    mockServer.all('/echo-headers', async (req, reply) => {
      return reply.status(200).send({
        requestId: req.headers['x-request-id'] ?? null,
        idempotencyKey: req.headers['x-idempotency-key'] ?? null,
        customHeader: req.headers['x-custom'] ?? null,
      });
    });

    const address = await mockServer.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await mockServer.close();
  });

  // ── Successful requests ───────────────────────────────

  it('should return success for 200 response', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/ok`,
      method: 'POST',
      body: { test: true },
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ result: 'success' });
    expect(result.requestId).toBeDefined();
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.errorClassification).toBeUndefined();
  });

  // ── Error classification ──────────────────────────────

  it('should classify 503 as SERVER_ERROR', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/server-error`,
      method: 'POST',
      body: { test: true },
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.errorClassification).toBe(ErrorClassification.SERVER_ERROR);
  });

  it('should classify 422 as CLIENT_ERROR', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/client-error`,
      method: 'POST',
      body: { test: true },
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(422);
    expect(result.errorClassification).toBe(ErrorClassification.CLIENT_ERROR);
  });

  it('should classify timeout as TIMEOUT', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/slow`,
      method: 'POST',
      body: { test: true },
      timeoutMs: 500,
    });

    expect(result.success).toBe(false);
    expect(result.errorClassification).toBe(ErrorClassification.TIMEOUT);
    expect(result.error).toContain('timed out');
  });

  it('should classify connection refused as CONNECTION_ERROR', async () => {
    const result = await httpTransport({
      url: 'http://127.0.0.1:1',
      method: 'POST',
      timeoutMs: 2000,
    });

    expect(result.success).toBe(false);
    expect(result.errorClassification).toBe(ErrorClassification.CONNECTION_ERROR);
  });

  // ── Headers ───────────────────────────────────────────

  it('should include X-Request-ID in every request', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/echo-headers`,
      method: 'POST',
      body: {},
    });

    expect(result.success).toBe(true);
    expect((result.body as Record<string, unknown>)?.requestId).toBeDefined();
    expect(typeof (result.body as Record<string, unknown>)?.requestId).toBe('string');
  });

  it('should forward custom headers', async () => {
    const result = await httpTransport({
      url: `${baseUrl}/echo-headers`,
      method: 'POST',
      body: {},
      headers: {
        'X-Idempotency-Key': 'saga-123:payment:ACTION',
        'X-Custom': 'test-value',
      },
    });

    expect(result.success).toBe(true);
    expect((result.body as Record<string, unknown>)?.idempotencyKey).toBe('saga-123:payment:ACTION');
    expect((result.body as Record<string, unknown>)?.customHeader).toBe('test-value');
  });

  // ── Retryable classification ──────────────────────────

  it('should mark TIMEOUT as retryable', () => {
    expect(isRetryableError(ErrorClassification.TIMEOUT)).toBe(true);
  });

  it('should mark CONNECTION_ERROR as retryable', () => {
    expect(isRetryableError(ErrorClassification.CONNECTION_ERROR)).toBe(true);
  });

  it('should mark SERVER_ERROR as retryable', () => {
    expect(isRetryableError(ErrorClassification.SERVER_ERROR)).toBe(true);
  });

  it('should mark CLIENT_ERROR as NOT retryable', () => {
    expect(isRetryableError(ErrorClassification.CLIENT_ERROR)).toBe(false);
  });

  it('should mark UNKNOWN as NOT retryable', () => {
    expect(isRetryableError(ErrorClassification.UNKNOWN)).toBe(false);
  });

  // ── Request ID uniqueness ─────────────────────────────

  it('should generate unique request IDs per call', async () => {
    const r1 = await httpTransport({ url: `${baseUrl}/ok`, method: 'POST', body: {} });
    const r2 = await httpTransport({ url: `${baseUrl}/ok`, method: 'POST', body: {} });

    expect(r1.requestId).not.toBe(r2.requestId);
  });
});
