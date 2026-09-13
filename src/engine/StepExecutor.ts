// ============================================================
// Chronos — Step Executor
// ============================================================
// Handles the actual HTTP call to a downstream service for a
// single workflow step. Wraps Node's built-in fetch with
// timeout support and structured result handling.
// ============================================================

import { type StepOperation } from '../types/index.js';

/**
 * Result of executing a single step operation.
 */
export interface StepExecutionResult {
  success: boolean;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  error?: string;
  executionTimeMs: number;
}

/**
 * Execute a single step operation (action or compensation)
 * by making an HTTP call to the configured URL.
 *
 * @param operation - The step operation config (url, method, timeout)
 * @param payload - The request body to send
 * @returns Structured result with success/failure info
 */
export async function executeStep(
  operation: StepOperation,
  payload: Record<string, unknown>
): Promise<StepExecutionResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutMs = operation.timeoutMs ?? 5000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(operation.url, {
      method: operation.method,
      headers: {
        'Content-Type': 'application/json',
        ...operation.headers,
      },
      body: ['POST', 'PUT', 'PATCH'].includes(operation.method)
        ? JSON.stringify(payload)
        : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const executionTimeMs = Date.now() - startTime;

    // Try to parse response body as JSON
    let responseBody: Record<string, unknown> | undefined;
    try {
      responseBody = (await response.json()) as Record<string, unknown>;
    } catch {
      // Response wasn't JSON — that's OK
    }

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        responseBody,
        executionTimeMs,
      };
    }

    return {
      success: false,
      statusCode: response.status,
      responseBody,
      error: `HTTP ${response.status}: ${response.statusText}`,
      executionTimeMs,
    };
  } catch (err) {
    const executionTimeMs = Date.now() - startTime;

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: `Timeout: operation exceeded ${operation.timeoutMs ?? 5000}ms`,
        executionTimeMs,
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      executionTimeMs,
    };
  }
}
