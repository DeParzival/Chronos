// ============================================================
// Chronos — Unit Tests: Lease-Aware Executor
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { executeWithLease } from '../../src/distributed/LeaseAwareExecutor.js';
import { DistributedLease, type LeaseHandle, type RedisClient } from '../../src/distributed/DistributedLease.js';

// ── Mock Redis ─────────────────────────────────────────────

class MockRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async set(
    key: string, value: string, expiryMode: string, time: number, setMode: string
  ): Promise<string | null> {
    if (setMode === 'NX') {
      const existing = this.store.get(key);
      if (existing && existing.expiresAt > Date.now()) return null;
    }
    const ttlMs = expiryMode === 'EX' ? time * 1000 : time;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { this.store.delete(key); return null; }
    return entry.value;
  }

  async eval(script: string, _numkeys: number, ...args: (string | number)[]): Promise<unknown> {
    const key = args[0] as string;
    const ownerId = args[1] as string;
    if (script.includes('DEL')) {
      const entry = this.store.get(key);
      if (entry && entry.value === ownerId) { this.store.delete(key); return 1; }
      return 0;
    }
    if (script.includes('PEXPIRE')) {
      const entry = this.store.get(key);
      if (entry && entry.value === ownerId) { entry.expiresAt = Date.now() + (args[2] as number); return 1; }
      return 0;
    }
    return 0;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

describe('LeaseAwareExecutor', () => {
  let redis: MockRedis;
  let lease: DistributedLease;

  beforeEach(() => {
    redis = new MockRedis();
    lease = new DistributedLease(redis, { ttlSeconds: 30 }, 'test-instance');
  });

  it('should acquire lease, execute, and release', async () => {
    let executed = false;

    const result = await executeWithLease(
      'saga-1',
      lease,
      async (_handle) => {
        executed = true;
        return 'done';
      },
      { renewIntervalMs: 60000, renewTtlMs: 30000 } // long interval so no renewals fire
    );

    expect(result.leaseAcquired).toBe(true);
    expect(result.result).toBe('done');
    expect(result.leaseLost).toBe(false);
    expect(executed).toBe(true);

    // Lease should be released — can acquire again
    const handle = await lease.acquire('saga-1');
    expect(handle).not.toBeNull();
  });

  it('should skip execution when lease cannot be acquired', async () => {
    // Another instance holds the lease
    const otherLease = new DistributedLease(redis, { ttlSeconds: 30 }, 'other-instance');
    await otherLease.acquire('saga-1');

    let executed = false;

    const result = await executeWithLease(
      'saga-1',
      lease,
      async () => {
        executed = true;
        return 'done';
      }
    );

    expect(result.leaseAcquired).toBe(false);
    expect(result.result).toBeUndefined();
    expect(executed).toBe(false);
  });

  it('should handle executor errors and still release lease', async () => {
    const result = await executeWithLease(
      'saga-1',
      lease,
      async () => {
        throw new Error('Execution failed');
      },
      { renewIntervalMs: 60000, renewTtlMs: 30000 }
    );

    expect(result.leaseAcquired).toBe(true);
    expect(result.error).toBe('Execution failed');

    // Lease should still be released
    const handle = await lease.acquire('saga-1');
    expect(handle).not.toBeNull();
  });

  it('should pass the lease handle to the executor', async () => {
    let receivedHandle: LeaseHandle | null = null;

    await executeWithLease(
      'saga-1',
      lease,
      async (handle) => {
        receivedHandle = handle;
        return 'done';
      },
      { renewIntervalMs: 60000, renewTtlMs: 30000 }
    );

    expect(receivedHandle).not.toBeNull();
    expect(receivedHandle!.sagaId).toBe('saga-1');
  });

  it('should allow different sagas to execute concurrently', async () => {
    const results = await Promise.all([
      executeWithLease('saga-1', lease, async () => 'result-1', { renewIntervalMs: 60000, renewTtlMs: 30000 }),
      executeWithLease('saga-2', lease, async () => 'result-2', { renewIntervalMs: 60000, renewTtlMs: 30000 }),
    ]);

    expect(results[0]?.leaseAcquired).toBe(true);
    expect(results[0]?.result).toBe('result-1');
    expect(results[1]?.leaseAcquired).toBe(true);
    expect(results[1]?.result).toBe('result-2');
  });
});
