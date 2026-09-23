// ============================================================
// Chronos — Unit Tests: Distributed Lease
// ============================================================
// Uses a mock Redis client to test lease logic without
// requiring a real Redis connection.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DistributedLease,
  type RedisClient,
  type LeaseHandle,
} from '../../src/distributed/DistributedLease.js';

// ── Mock Redis Client ──────────────────────────────────────

class MockRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async set(
    key: string,
    value: string,
    expiryMode: string,
    time: number,
    setMode: string
  ): Promise<string | null> {
    if (setMode === 'NX') {
      const existing = this.store.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        return null; // Key exists and hasn't expired
      }
    }

    const ttlMs = expiryMode === 'EX' ? time * 1000 : time;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async eval(
    script: string,
    _numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const key = args[0] as string;
    const ownerId = args[1] as string;

    // Simplified Lua script simulation
    if (script.includes('DEL')) {
      // Release script
      const entry = this.store.get(key);
      if (entry && entry.value === ownerId && entry.expiresAt > Date.now()) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }

    if (script.includes('PEXPIRE')) {
      // Extend script
      const newTtlMs = args[2] as number;
      const entry = this.store.get(key);
      if (entry && entry.value === ownerId && entry.expiresAt > Date.now()) {
        entry.expiresAt = Date.now() + newTtlMs;
        return 1;
      }
      return 0;
    }

    return 0;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  // Test helper
  clear(): void {
    this.store.clear();
  }
}

describe('DistributedLease', () => {
  let redis: MockRedis;
  let lease: DistributedLease;

  beforeEach(() => {
    redis = new MockRedis();
    lease = new DistributedLease(redis, { ttlSeconds: 30 }, 'instance-1');
  });

  // ── Acquisition ───────────────────────────────────────

  it('should acquire a lease for a saga', async () => {
    const handle = await lease.acquire('saga-123');

    expect(handle).not.toBeNull();
    expect(handle!.sagaId).toBe('saga-123');
    expect(handle!.key).toBe('chronos:lease:saga-123');
    expect(handle!.ownerId).toContain('instance-1');
  });

  it('should fail to acquire if another instance holds the lease', async () => {
    const lease2 = new DistributedLease(redis, {}, 'instance-2');

    const handle1 = await lease.acquire('saga-123');
    const handle2 = await lease2.acquire('saga-123');

    expect(handle1).not.toBeNull();
    expect(handle2).toBeNull();
  });

  it('should allow acquiring different sagas concurrently', async () => {
    const h1 = await lease.acquire('saga-1');
    const h2 = await lease.acquire('saga-2');

    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(h1!.sagaId).toBe('saga-1');
    expect(h2!.sagaId).toBe('saga-2');
  });

  // ── Release ───────────────────────────────────────────

  it('should release a lease we own', async () => {
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();

    const released = await lease.release(handle!);
    expect(released).toBe(true);

    // Should be acquirable again
    const handle2 = await lease.acquire('saga-123');
    expect(handle2).not.toBeNull();
  });

  it('should not release a lease owned by another instance', async () => {
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();

    // Create a fake handle with wrong owner
    const fakeHandle: LeaseHandle = {
      ...handle!,
      ownerId: 'fake-owner',
    };

    const released = await lease.release(fakeHandle);
    expect(released).toBe(false);
  });

  // ── Extend ────────────────────────────────────────────

  it('should extend a lease we own', async () => {
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();

    const extended = await lease.extend(handle!, 60000);
    expect(extended).toBe(true);
  });

  it('should not extend a lease owned by another instance', async () => {
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();

    const fakeHandle: LeaseHandle = {
      ...handle!,
      ownerId: 'fake-owner',
    };

    const extended = await lease.extend(fakeHandle, 60000);
    expect(extended).toBe(false);
  });

  // ── isHeld ────────────────────────────────────────────

  it('should report lease as held when we own it', async () => {
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();

    const held = await lease.isHeld(handle!);
    expect(held).toBe(true);
  });

  it('should report lease as not held after release', async () => {
    const handle = await lease.acquire('saga-123');
    await lease.release(handle!);

    const held = await lease.isHeld(handle!);
    expect(held).toBe(false);
  });

  // ── Force release ─────────────────────────────────────

  it('should force-release regardless of owner', async () => {
    await lease.acquire('saga-123');

    const released = await lease.forceRelease('saga-123');
    expect(released).toBe(true);

    // Should be acquirable again
    const handle = await lease.acquire('saga-123');
    expect(handle).not.toBeNull();
  });

  // ── Instance ID ───────────────────────────────────────

  it('should expose the instance ID', () => {
    expect(lease.getInstanceId()).toBe('instance-1');
  });

  it('should generate a unique instance ID if not provided', () => {
    const autoLease = new DistributedLease(redis);
    expect(autoLease.getInstanceId()).toBeDefined();
    expect(autoLease.getInstanceId().length).toBeGreaterThan(0);
  });
});
