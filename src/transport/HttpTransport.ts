// ============================================================
// Chronos — HTTP Transport Client
// ============================================================
// A structured HTTP client that wraps Node's native fetch with:
// - Configurable timeouts via AbortController
// - Request ID generation for tracing
// - Error classification (timeout, connection, server, client)
// - Custom header support (for idempotency keys, auth, etc.)
//
// This replaces the raw fetch usage in StepExecutor with a
// transport that gives the retry policy enough info to decide
// whether a failure is retryable.
// ============================================================

import { v4 as uuidv4 } from 'uuid';

// ── Error Classifications ──────────────────────────────────

export enum ErrorClassification {
  /** Request exceeded the configured timeout */
  TIMEOUT = 'TIMEOUT',
  /** Could not connect to the target service */
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  /** Service returned 5xx — usually retryable */
  SERVER_ERROR = 'SERVER_ERROR',
  /** Service returned 4xx — usually NOT retryable */
  CLIENT_ERROR = 'CLIENT_ERROR',
  /** Unexpected/unknown failure */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Whether an error classification is typically retryable.
 */
export function isRetryableError(classification: ErrorClassification): boolean {
  return (
    classification === ErrorClassification.TIMEOUT ||
    classification === ErrorClassification.CONNECTION_ERROR ||
    classification === ErrorClassification.SERVER_ERROR
  );
}

// ── Types ──────────────────────────────────────────────────

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface TransportResponse {
  success: boolean;
  statusCode?: number;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  error?: string;
  errorClassification?: ErrorClassification;
  executionTimeMs: number;
  requestId: string;
}

// ── HTTP Transport ─────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Execute an HTTP request with timeout, error classification,
 * and request tracing.
 */
export async function httpTransport(
  request: TransportRequest
): Promise<TransportResponse> {
  const requestId = uuidv4();
  const startTime = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);

    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...request.headers,
      },
      body: hasBody && request.body ? JSON.stringify(request.body) : undefined,
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

    // Extract response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        body: responseBody,
        headers: responseHeaders,
        executionTimeMs,
        requestId,
      };
    }

    // Classify the error
    const classification =
      response.status >= 500
        ? ErrorClassification.SERVER_ERROR
        : ErrorClassification.CLIENT_ERROR;

    return {
      success: false,
      statusCode: response.status,
      body: responseBody,
      headers: responseHeaders,
      error: `HTTP ${response.status}: ${response.statusText}`,
      errorClassification: classification,
      executionTimeMs,
      requestId,
    };
  } catch (err) {
    const executionTimeMs = Date.now() - startTime;

    // Timeout
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: `Request timed out after ${timeoutMs}ms`,
        errorClassification: ErrorClassification.TIMEOUT,
        executionTimeMs,
        requestId,
      };
    }

    // Connection errors (ECONNREFUSED, ENOTFOUND, etc.)
    if (err instanceof TypeError || (err instanceof Error && isConnectionError(err))) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        errorClassification: ErrorClassification.CONNECTION_ERROR,
        executionTimeMs,
        requestId,
      };
    }

    // Unknown
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      errorClassification: ErrorClassification.UNKNOWN,
      executionTimeMs,
      requestId,
    };
  }
}

/**
 * Check if an error looks like a connection error.
 */
function isConnectionError(err: Error): boolean {
  const message = err.message.toLowerCase();
  return (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('epipe') ||
    message.includes('etimedout') ||
    message.includes('fetch failed')
  );
}
