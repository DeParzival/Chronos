// ============================================================
// SagaFlow — Unit Tests: Fastify Health Check
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { type AppConfig } from '../../src/config/index.js';

describe('Health Check Endpoint', () => {
  let app: FastifyInstance;

  const testConfig: AppConfig = {
    port: 0, // random port for tests
    nodeEnv: 'test',
    logLevel: 'error',
    databaseUrl: 'postgresql://sagaflow:sagaflow@localhost:5432/sagaflow',
    redisUrl: 'redis://localhost:6379',
  };

  beforeAll(async () => {
    app = await buildApp(testConfig);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should respond to GET /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(503); // unhealthy — no connections yet
    const body = response.json();

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('services');
    expect(body.services).toHaveProperty('postgresql');
    expect(body.services).toHaveProperty('redis');
  });

  it('should report services as disconnected before connections are established', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(body.services.postgresql).toBe('disconnected');
    expect(body.services.redis).toBe('disconnected');
    expect(body.status).toBe('unhealthy');
  });

  it('should include version information', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(body.version).toBe('0.1.0');
  });

  it('should return a valid ISO timestamp', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    const date = new Date(body.timestamp);
    expect(date.toISOString()).toBe(body.timestamp);
  });

  it('should return 404 for unknown routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/unknown',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('Not Found');
  });
});
