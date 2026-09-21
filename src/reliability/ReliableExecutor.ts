// ============================================================
// Chronos — Reliable Step Executor
// ============================================================
// Wraps the HTTP transport + retry policy + idempotency into
// a single execution pipeline for saga steps.
//
// Pipeline for each step:
//   1. Generate idempotency key
//   2. Check idempotency registry → cached? return cached
//   3. Execute with retry policy (exponential backoff)
//   4. Store result in idempotency registry
//   5. Return result
//
// This module replaces direct StepExecutor usage in the engine,
// adding reliability without changing the engine's logic.
// ============================================================

import { type StepOperation, type StepType } from '../types/index.js';
import { type TransportResponse, httpTransport } from '../transport/HttpTransport.js';
import {
  executeWithRetry,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './RetryPolicy.js';
import { generateIdempotencyKey } from './IdempotencyKey.js';
import { type IdempotencyRegistry } from './IdempotencyRegistry.js';

/**
 * Result of a reliable step execution.
 */
export interface ReliableStepResult {
  success: boolean;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  error?: string;
  executionTimeMs: number;
  /** Total attempts made (1 = no retries) */
  totalAttempts: number;
  /** Whether the result came from the idempotency cache */
  fromCache: boolean;
  /** The idempotency key used */
  idempotencyKey: string;
}

/**
 * Configuration for the reliable executor.
 */
export interface ReliableExecutorConfig {
  retryConfig?: RetryConfig;
  /** Whether to use idempotency checks (default: true) */
  enableIdempotency?: boolean;
}

/**
 * Execute a saga step with full reliability:
 * idempotency check → retry with backoff → store result.
 */
export async function executeReliableStep(
  operation: StepOperation,
  payload: Record<string, unknown>,
  sagaId: string,
  stepName: string,
  stepType: StepType,
  idempotencyRegistry: IdempotencyRegistry | null,
  config: ReliableExecutorConfig = {}
): Promise<ReliableStepResult> {
  const {
    retryConfig = DEFAULT_RETRY_CONFIG,
    enableIdempotency = true,
  } = config;
  const startTime = Date.now();

  // Generate idempotency key
  const idempotencyKey = generateIdempotencyKey(sagaId, stepName, stepType);

  // ── Step 1: Check idempotency cache ───────────────────
  if (enableIdempotency && idempotencyRegistry) {
    const cached = await idempotencyRegistry.check(idempotencyKey);
    if (cached) {
      return {
        success: cached.statusCode >= 200 && cached.statusCode < 300,
        statusCode: cached.statusCode,
        responseBody: cached.response,
        executionTimeMs: Date.now() - startTime,
        totalAttempts: 0,
        fromCache: true,
        idempotencyKey,
      };
    }
  }

  // ── Step 2: Execute with retry ────────────────────────
  const retryResult = await executeWithRetry(
    {
      url: operation.url,
      method: operation.method,
      body: payload,
      headers: {
        'X-Idempotency-Key': idempotencyKey,
        ...operation.headers,
      },
      timeoutMs: operation.timeoutMs,
    },
    retryConfig
  );

  const response = retryResult.response;

  // ── Step 3: Store in idempotency registry ─────────────
  if (enableIdempotency && idempotencyRegistry && response.statusCode) {
    await idempotencyRegistry.store(
      idempotencyKey,
      response.body ?? {},
      response.statusCode
    );
  }

  return {
    success: response.success,
    statusCode: response.statusCode,
    responseBody: response.body,
    error: response.error,
    executionTimeMs: Date.now() - startTime,
    totalAttempts: retryResult.totalAttempts,
    fromCache: false,
    idempotencyKey,
  };
}
