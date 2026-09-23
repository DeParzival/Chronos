// ============================================================
// Chronos — Unit Tests: Lease Heartbeat
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LeaseHeartbeat } from '../../src/distributed/LeaseHeartbeat.js';
import { type LeaseHandle } from '../../src/distributed/DistributedLease.js';

// ── Mock DistributedLease ──────────────────────────────────

class MockDistributedLease {
  public extendCalls = 0;
  public shouldExtendSucceed = true;

  async extend(_handle: LeaseHandle, _ttlMs: number): Promise<boolean> {
    this.extendCalls++;
    return this.shouldExtendSucceed;
  }
}

const makeHandle = (): LeaseHandle => ({
  sagaId: 'saga-test',
  ownerId: 'owner-1',
  key: 'chronos:lease:saga-test',
  acquiredAt: new Date(),
});

describe('LeaseHeartbeat', () => {
  let mockLease: MockDistributedLease;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLease = new MockDistributedLease();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start and report running status', () => {
    const heartbeat = new LeaseHeartbeat(
      mockLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      { renewIntervalMs: 1000, renewTtlMs: 5000 }
    );

    heartbeat.start(makeHandle());

    expect(heartbeat.getStatus().isRunning).toBe(true);
    expect(heartbeat.getStatus().startedAt).not.toBeNull();

    heartbeat.stop();
  });

  it('should extend the lease on each interval', async () => {
    const heartbeat = new LeaseHeartbeat(
      mockLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      { renewIntervalMs: 1000, renewTtlMs: 5000 }
    );

    heartbeat.start(makeHandle());

    // Advance timer 3 intervals
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockLease.extendCalls).toBe(3);
    expect(heartbeat.getStatus().renewalCount).toBe(3);

    heartbeat.stop();
  });

  it('should stop and report not running', () => {
    const heartbeat = new LeaseHeartbeat(
      mockLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      { renewIntervalMs: 1000, renewTtlMs: 5000 }
    );

    heartbeat.start(makeHandle());
    heartbeat.stop();

    expect(heartbeat.getStatus().isRunning).toBe(false);
  });

  it('should detect lease lost when extend fails', async () => {
    let leaseLostCalled = false;

    const heartbeat = new LeaseHeartbeat(
      mockLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      {
        renewIntervalMs: 1000,
        renewTtlMs: 5000,
        onLeaseLost: () => { leaseLostCalled = true; },
      }
    );

    heartbeat.start(makeHandle());

    // First renewal succeeds
    await vi.advanceTimersByTimeAsync(1000);
    expect(heartbeat.getStatus().renewalCount).toBe(1);

    // Make next renewal fail
    mockLease.shouldExtendSucceed = false;
    await vi.advanceTimersByTimeAsync(1000);

    expect(heartbeat.getStatus().leaseLost).toBe(true);
    expect(heartbeat.getStatus().isRunning).toBe(false);
    expect(leaseLostCalled).toBe(true);
  });

  it('should throw if started twice', () => {
    const heartbeat = new LeaseHeartbeat(
      mockLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      { renewIntervalMs: 1000, renewTtlMs: 5000 }
    );

    heartbeat.start(makeHandle());

    expect(() => heartbeat.start(makeHandle())).toThrow('already running');

    heartbeat.stop();
  });

  it('should track failure count separately', async () => {
    // Simulate extend throwing an error (transient)
    const throwingLease = {
      extend: async () => { throw new Error('Redis connection lost'); },
    };

    const heartbeat = new LeaseHeartbeat(
      throwingLease as unknown as import('../../src/distributed/DistributedLease.js').DistributedLease,
      { renewIntervalMs: 1000, renewTtlMs: 5000 }
    );

    heartbeat.start(makeHandle());
    await vi.advanceTimersByTimeAsync(2000);

    // Transient errors increment failureCount but don't stop heartbeat
    expect(heartbeat.getStatus().failureCount).toBe(2);
    expect(heartbeat.getStatus().isRunning).toBe(true);

    heartbeat.stop();
  });
});
