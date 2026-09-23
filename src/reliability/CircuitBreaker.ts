// ============================================================
// Chronos — Circuit Breaker
// ============================================================
// Protects downstream services from being overwhelmed when
// they are failing. Follows the standard circuit breaker
// pattern with three states: CLOSED, OPEN, HALF_OPEN.
//
// State transitions:
//   CLOSED → (failures ≥ threshold) → OPEN
//   OPEN → (timeout expires) → HALF_OPEN
//   HALF_OPEN → (probe succeeds) → CLOSED
//   HALF_OPEN → (probe fails) → OPEN
// ============================================================

// ── Types ──────────────────────────────────────────────────

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening (default: 5) */
  failureThreshold: number;
  /** Time to stay OPEN before trying HALF_OPEN, in ms (default: 30000) */
  resetTimeoutMs: number;
  /** Max probe requests in HALF_OPEN state (default: 1) */
  halfOpenMaxAttempts: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 1,
};

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  halfOpenAttempts: number;
}

// ── Circuit Breaker ────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private halfOpenAttempts = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private readonly config: CircuitBreakerConfig;

  /** Name of the service this breaker protects */
  public readonly serviceName: string;

  constructor(serviceName: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.serviceName = serviceName;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(this.serviceName, this.getTimeUntilReset());
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Check if the circuit allows execution.
   */
  canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if reset timeout has passed
        if (this.shouldTransitionToHalfOpen()) {
          this.transitionTo(CircuitState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;
    }
  }

  /**
   * Record a successful execution.
   */
  onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = new Date();

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        // Probe succeeded — close the circuit
        this.transitionTo(CircuitState.CLOSED);
        break;
      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        break;
    }
  }

  /**
   * Record a failed execution.
   */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionTo(CircuitState.OPEN);
        }
        break;
      case CircuitState.HALF_OPEN:
        // Probe failed — re-open the circuit
        this.transitionTo(CircuitState.OPEN);
        break;
    }
  }

  /**
   * Get the current status.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  /**
   * Get the current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Manually reset the circuit to CLOSED.
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  // ── Private ───────────────────────────────────────────

  private transitionTo(newState: CircuitState): void {
    this.state = newState;

    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
    }

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    }
  }

  private shouldTransitionToHalfOpen(): boolean {
    if (!this.lastFailureTime) return false;
    const elapsed = Date.now() - this.lastFailureTime.getTime();
    return elapsed >= this.config.resetTimeoutMs;
  }

  private getTimeUntilReset(): number {
    if (!this.lastFailureTime) return 0;
    const elapsed = Date.now() - this.lastFailureTime.getTime();
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }
}

// ── Custom Error ───────────────────────────────────────────

export class CircuitOpenError extends Error {
  public readonly serviceName: string;
  public readonly retryAfterMs: number;

  constructor(serviceName: string, retryAfterMs: number) {
    super(
      `Circuit breaker OPEN for service "${serviceName}". ` +
      `Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    );
    this.name = 'CircuitOpenError';
    this.serviceName = serviceName;
    this.retryAfterMs = retryAfterMs;
  }
}
