// ============================================================
// Chronos — Lease Heartbeat
// ============================================================
// Keeps a distributed lease alive while a saga is executing.
//
// Starts a background interval that periodically extends the
// lease's TTL. If the extension fails (lease stolen), it
// signals the caller to stop processing.
// ============================================================

import {
  type DistributedLease,
  type LeaseHandle,
} from './DistributedLease.js';

/**
 * Heartbeat configuration.
 */
export interface HeartbeatConfig {
  /** How often to renew the lease, in milliseconds (default: 10000) */
  renewIntervalMs: number;
  /** TTL to set on each renewal, in milliseconds (default: 30000) */
  renewTtlMs: number;
  /** Callback when a renewal fails (lease lost) */
  onLeaseLost?: (handle: LeaseHandle) => void;
}

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  renewIntervalMs: 10000,
  renewTtlMs: 30000,
};

/**
 * Heartbeat result for monitoring.
 */
export interface HeartbeatStatus {
  /** Whether the heartbeat is currently running */
  isRunning: boolean;
  /** Total number of successful renewals */
  renewalCount: number;
  /** Total number of failed renewals */
  failureCount: number;
  /** Whether the lease was lost */
  leaseLost: boolean;
  /** When the heartbeat was started */
  startedAt: Date | null;
}

/**
 * Manages a background timer that periodically extends
 * a distributed lease's TTL.
 */
export class LeaseHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private renewalCount = 0;
  private failureCount = 0;
  private leaseLost = false;
  private startedAt: Date | null = null;
  private readonly config: HeartbeatConfig;

  constructor(
    private readonly distributedLease: DistributedLease,
    config: Partial<HeartbeatConfig> = {}
  ) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
  }

  /**
   * Start the heartbeat for a lease handle.
   * Returns immediately — the heartbeat runs in the background.
   */
  start(handle: LeaseHandle): void {
    if (this.running) {
      throw new Error('Heartbeat is already running');
    }

    this.running = true;
    this.renewalCount = 0;
    this.failureCount = 0;
    this.leaseLost = false;
    this.startedAt = new Date();

    this.timer = setInterval(async () => {
      try {
        const extended = await this.distributedLease.extend(
          handle,
          this.config.renewTtlMs
        );

        if (extended) {
          this.renewalCount++;
        } else {
          this.failureCount++;
          this.leaseLost = true;
          this.stop();
          this.config.onLeaseLost?.(handle);
        }
      } catch {
        this.failureCount++;
        // Don't stop on transient errors — just log and retry next interval
      }
    }, this.config.renewIntervalMs);
  }

  /**
   * Stop the heartbeat.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * Get the current heartbeat status.
   */
  getStatus(): HeartbeatStatus {
    return {
      isRunning: this.running,
      renewalCount: this.renewalCount,
      failureCount: this.failureCount,
      leaseLost: this.leaseLost,
      startedAt: this.startedAt,
    };
  }
}
