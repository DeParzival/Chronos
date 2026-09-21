// ============================================================
// Chronos — Retry Policy
// ============================================================
// Implements exponential backoff with jitter for retrying
// failed operations.
//
// Formula:
//   delay = min(baseDelay × 2^attempt + random(0, jitter), maxDelay)
//
// This prevents the "thundering herd" problem where all clients
// retry at the same time after a service recovers.
// ============================================================

import {
  type TransportRequest,
  type TransportResponse,
  httpTransport,
  isRetryableError,
} from '../transport/HttpTransport.js';

// ── Configuration ──────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number;
  /** Base delay in milliseconds before first retry */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Random jitter range in milliseconds */
  jitterMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

// ── Retry Result ───────────────────────────────────────────

export interface RetryResult {
  /** The final transport response */
  response: TransportResponse;
  /** Total number of attempts made (1 = no retries needed) */
  totalAttempts: number;
  /** Whether the request was retried at all */
  wasRetried: boolean;
  /** Delay before each retry attempt (in ms) */
  retryDelays: number[];
}

// ── Core Functions ─────────────────────────────────────────

/**
 * Calculate the delay before a retry attempt using exponential
 * backoff with jitter.
 *
 * @param attempt - The retry attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: baseDelay × 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Add random jitter
  const jitter = Math.random() * config.jitterMs;

  // Cap at maxDelay
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Sleep for a specified duration.
 * Extracted for testability.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an HTTP request with automatic retries on retryable errors.
 *
 * Only retries on:
 * - TIMEOUT errors
 * - CONNECTION_ERROR errors
 * - SERVER_ERROR (5xx) errors
 *
 * Does NOT retry on:
 * - CLIENT_ERROR (4xx) — the request itself is wrong
 * - UNKNOWN errors
 * - Successful responses
 */
export async function executeWithRetry(
  request: TransportRequest,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<RetryResult> {
  const retryDelays: number[] = [];
  let lastResponse: TransportResponse | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Wait before retry (not before first attempt)
    if (attempt > 0) {
      const delay = calculateDelay(attempt - 1, config);
      retryDelays.push(delay);
      await sleepFn(delay);
    }

    // Execute the request
    lastResponse = await httpTransport(request);

    // Success — return immediately
    if (lastResponse.success) {
      return {
        response: lastResponse,
        totalAttempts: attempt + 1,
        wasRetried: attempt > 0,
        retryDelays,
      };
    }

    // Non-retryable error — don't retry
    if (
      lastResponse.errorClassification &&
      !isRetryableError(lastResponse.errorClassification)
    ) {
      return {
        response: lastResponse,
        totalAttempts: attempt + 1,
        wasRetried: attempt > 0,
        retryDelays,
      };
    }

    // Retryable error — continue loop (will retry unless maxRetries reached)
  }

  // All retries exhausted
  return {
    response: lastResponse!,
    totalAttempts: config.maxRetries + 1,
    wasRetried: config.maxRetries > 0,
    retryDelays,
  };
}
