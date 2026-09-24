// ============================================================
// Chronos — Unit Tests: Mock Microservice
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import {
  MockService,
  createPaymentService,
  createInventoryService,
  createShippingService,
} from '../../src/testing/MockService.js';

describe('MockService', () => {
  const services: MockService[] = [];

  const trackService = (svc: MockService) => {
    services.push(svc);
    return svc;
  };

  afterEach(async () => {
    for (const svc of services) await svc.stop();
    services.length = 0;
  });

  // ── Basic functionality ───────────────────────────────

  it('should start and respond to requests', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{ path: '/test', responseBody: { ok: true } }],
    }));
    const url = await svc.start();

    const res = await fetch(`${url}/test`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('should record incoming requests', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{ path: '/test' }],
    }));
    await svc.start();

    await fetch(`${svc.url}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ord_1' }),
    });

    expect(svc.requestCount).toBe(1);
    expect(svc.requests[0]?.body).toEqual({ orderId: 'ord_1' });
  });

  it('should filter requests by endpoint', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [
        { path: '/a' },
        { path: '/b' },
      ],
    }));
    await svc.start();

    await fetch(`${svc.url}/a`, { method: 'POST' });
    await fetch(`${svc.url}/b`, { method: 'POST' });
    await fetch(`${svc.url}/a`, { method: 'POST' });

    expect(svc.getRequestsTo('/a')).toHaveLength(2);
    expect(svc.getRequestsTo('/b')).toHaveLength(1);
  });

  it('should clear recorded requests', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{ path: '/test' }],
    }));
    await svc.start();

    await fetch(`${svc.url}/test`, { method: 'POST' });
    expect(svc.requestCount).toBe(1);

    svc.clearRequests();
    expect(svc.requestCount).toBe(0);
  });

  // ── Configurable responses ────────────────────────────

  it('should return custom status codes', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{ path: '/fail', statusCode: 422, responseBody: { error: 'invalid' } }],
    }));
    await svc.start();

    const res = await fetch(`${svc.url}/fail`, { method: 'POST' });
    expect(res.status).toBe(422);
  });

  it('should simulate latency', async () => {
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{ path: '/slow', latencyMs: 200 }],
    }));
    await svc.start();

    const start = Date.now();
    await fetch(`${svc.url}/slow`, { method: 'POST' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(150); // allow some tolerance
  });

  it('should support custom handlers', async () => {
    let callCount = 0;
    const svc = trackService(new MockService({
      name: 'test-svc',
      endpoints: [{
        path: '/dynamic',
        handler: () => {
          callCount++;
          return { statusCode: 200, body: { count: callCount } };
        },
      }],
    }));
    await svc.start();

    await fetch(`${svc.url}/dynamic`, { method: 'POST' });
    const res = await fetch(`${svc.url}/dynamic`, { method: 'POST' });
    const body = await res.json();

    expect(body.count).toBe(2);
  });

  // ── Factory functions ─────────────────────────────────

  it('should create payment service with charge and refund endpoints', async () => {
    const svc = trackService(createPaymentService());
    await svc.start();

    const chargeRes = await fetch(`${svc.url}/charge`, { method: 'POST' });
    const refundRes = await fetch(`${svc.url}/refund`, { method: 'POST' });

    expect(chargeRes.status).toBe(200);
    expect(refundRes.status).toBe(200);
    expect(svc.name).toBe('payment-service');
  });

  it('should create inventory service with reserve and release endpoints', async () => {
    const svc = trackService(createInventoryService());
    await svc.start();

    const res = await fetch(`${svc.url}/reserve`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(svc.name).toBe('inventory-service');
  });

  it('should create shipping service with schedule and cancel endpoints', async () => {
    const svc = trackService(createShippingService());
    await svc.start();

    const res = await fetch(`${svc.url}/schedule`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(svc.name).toBe('shipping-service');
  });
});
