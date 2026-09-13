// ============================================================
// SagaFlow — Redis Client Module
// ============================================================
// Manages the Redis connection for:
// - Distributed locks/leases (Phase 6)
// - Caching workflow definitions
// - Rate limiting downstream services
// - Circuit breaker state (Phase 7)
//
// Redis complements PostgreSQL — PostgreSQL provides durability,
// Redis provides fast coordination.
// ============================================================

import Redis from 'ioredis';
import { type AppConfig } from '../config/index.js';

let redisClient: Redis | null = null;

/**
 * Create and configure the Redis client.
 *
 * Uses ioredis which provides:
 * - Automatic reconnection
 * - Lua scripting support (for atomic lease operations)
 * - Cluster support for production
 */
export function createRedisClient(config: AppConfig): Redis {
  redisClient = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      // Exponential backoff with max 30 seconds
      const delay = Math.min(times * 200, 30000);
      return delay;
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 5000,
  });

  redisClient.on('error', (err) => {
    console.error('Redis connection error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('Redis: connected');
  });

  redisClient.on('ready', () => {
    console.log('Redis: ready');
  });

  redisClient.on('reconnecting', () => {
    console.log('Redis: reconnecting...');
  });

  return redisClient;
}

/**
 * Get the current Redis client instance.
 * Throws if the client hasn't been initialized.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call createRedisClient() first.');
  }
  return redisClient;
}

/**
 * Check Redis connectivity by sending a PING command.
 */
export async function checkRedisConnection(client: Redis): Promise<boolean> {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Close the Redis connection gracefully.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
