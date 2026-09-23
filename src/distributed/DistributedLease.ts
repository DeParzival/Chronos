// ============================================================
// Chronos — Distributed Lease
// ============================================================
// Redis-backed distributed lock that ensures only one Chronos
// instance processes a given saga at a time.
//
// Uses Redis SET NX EX for atomic acquisition, and Lua scripts
// for atomic release/extend (check owner then modify).
// ============================================================

import { v4 as uuidv4 } from 'uuid';

/**
 * Minimal Redis client interface.
 * Compatible with ioredis.
 */
export interface RedisClient {
  set(
    key: string,
    value: string,
    expiryMode: string,
    time: number,
    setMode: string
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<number>;
}

// ── Configuration ──────────────────────────────────────────

export interface LeaseConfig {
  /** Lease TTL in seconds (default: 30) */
  ttlSeconds: number;
  /** Key prefix in Redis (default: 'chronos:lease:') */
  keyPrefix: string;
}

const DEFAULT_LEASE_CONFIG: LeaseConfig = {
  ttlSeconds: 30,
  keyPrefix: 'chronos:lease:',
};

// ── Lua Scripts ────────────────────────────────────────────
// These run atomically on Redis — no race conditions.

/** Release only if we own the lease */
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

/** Extend TTL only if we own the lease */
const EXTEND_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

// ── Lease Result ───────────────────────────────────────────

export interface LeaseHandle {
  /** The saga this lease is for */
  sagaId: string;
  /** The unique owner ID for this lease */
  ownerId: string;
  /** The Redis key used */
  key: string;
  /** When the lease was acquired */
  acquiredAt: Date;
}

// ── Distributed Lease ──────────────────────────────────────

export class DistributedLease {
  private readonly config: LeaseConfig;
  /** Unique identifier for this Chronos instance */
  private readonly instanceId: string;

  constructor(
    private readonly redis: RedisClient,
    config: Partial<LeaseConfig> = {},
    instanceId?: string
  ) {
    this.config = { ...DEFAULT_LEASE_CONFIG, ...config };
    this.instanceId = instanceId ?? uuidv4();
  }

  /**
   * Try to acquire a lease for a saga.
   * Returns a LeaseHandle if successful, null if the saga is
   * already leased by another instance.
   */
  async acquire(sagaId: string): Promise<LeaseHandle | null> {
    const key = this.getKey(sagaId);
    const ownerId = `${this.instanceId}:${uuidv4().slice(0, 8)}`;

    const result = await this.redis.set(
      key,
      ownerId,
      'EX',
      this.config.ttlSeconds,
      'NX'
    );

    if (result === null) {
      // Another instance already holds this lease
      return null;
    }

    return {
      sagaId,
      ownerId,
      key,
      acquiredAt: new Date(),
    };
  }

  /**
   * Release a lease. Only succeeds if we own it.
   * Returns true if released, false if we no longer own it.
   */
  async release(handle: LeaseHandle): Promise<boolean> {
    const result = await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      handle.key,
      handle.ownerId
    );

    return result === 1;
  }

  /**
   * Extend a lease's TTL. Only succeeds if we own it.
   * Returns true if extended, false if we no longer own it.
   */
  async extend(handle: LeaseHandle, ttlMs?: number): Promise<boolean> {
    const ttl = ttlMs ?? this.config.ttlSeconds * 1000;

    const result = await this.redis.eval(
      EXTEND_SCRIPT,
      1,
      handle.key,
      handle.ownerId,
      ttl
    );

    return result === 1;
  }

  /**
   * Check if we still hold a lease.
   */
  async isHeld(handle: LeaseHandle): Promise<boolean> {
    const value = await this.redis.get(handle.key);
    return value === handle.ownerId;
  }

  /**
   * Force-release a lease regardless of owner.
   * Use only for administrative/recovery purposes.
   */
  async forceRelease(sagaId: string): Promise<boolean> {
    const key = this.getKey(sagaId);
    const result = await this.redis.del(key);
    return result === 1;
  }

  /**
   * Get the instance ID for this Chronos process.
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Get the Redis key for a saga's lease.
   */
  private getKey(sagaId: string): string {
    return `${this.config.keyPrefix}${sagaId}`;
  }
}
