// ============================================================
// Chronos — Lease-Aware Executor
// ============================================================
// Wraps saga execution with distributed lease management:
//   1. Acquire lease
//   2. Start heartbeat
//   3. Execute saga
//   4. Stop heartbeat
//   5. Release lease
//
// If lease acquisition fails, execution is skipped (another
// instance is processing this saga).
// ============================================================

import { type DistributedLease, type LeaseHandle } from './DistributedLease.js';
import { LeaseHeartbeat, type HeartbeatConfig } from './LeaseHeartbeat.js';

/**
 * Result of a lease-aware execution.
 */
export interface LeaseAwareResult<T> {
  /** Whether the lease was acquired */
  leaseAcquired: boolean;
  /** The result from the executor (undefined if lease not acquired) */
  result?: T;
  /** The lease handle (for debugging) */
  leaseHandle?: LeaseHandle;
  /** Whether the lease was lost during execution */
  leaseLost: boolean;
  /** Error if execution failed */
  error?: string;
}

/**
 * Execute a function while holding a distributed lease.
 *
 * This is the core primitive for distributed saga execution.
 * Any function can be wrapped — the engine, compensation, recovery, etc.
 *
 * @param sagaId - The saga to lock
 * @param lease - The distributed lease service
 * @param executor - The function to execute while holding the lease
 * @param heartbeatConfig - Optional heartbeat configuration
 */
export async function executeWithLease<T>(
  sagaId: string,
  lease: DistributedLease,
  executor: (handle: LeaseHandle) => Promise<T>,
  heartbeatConfig?: Partial<HeartbeatConfig>
): Promise<LeaseAwareResult<T>> {
  // ── Step 1: Acquire lease ─────────────────────────────
  const handle = await lease.acquire(sagaId);

  if (!handle) {
    return {
      leaseAcquired: false,
      leaseLost: false,
    };
  }

  // ── Step 2: Start heartbeat ───────────────────────────
  let leaseLost = false;
  const heartbeat = new LeaseHeartbeat(lease, {
    ...heartbeatConfig,
    onLeaseLost: () => {
      leaseLost = true;
    },
  });

  heartbeat.start(handle);

  try {
    // ── Step 3: Execute ───────────────────────────────────
    const result = await executor(handle);

    return {
      leaseAcquired: true,
      result,
      leaseHandle: handle,
      leaseLost,
    };
  } catch (err) {
    return {
      leaseAcquired: true,
      leaseHandle: handle,
      leaseLost,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    // ── Step 4: Stop heartbeat ────────────────────────────
    heartbeat.stop();

    // ── Step 5: Release lease ─────────────────────────────
    // Only release if we haven't lost the lease
    if (!leaseLost) {
      await lease.release(handle).catch(() => {
        // Best-effort release — if it fails, TTL will expire
      });
    }
  }
}
