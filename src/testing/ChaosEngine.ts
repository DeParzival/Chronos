// ============================================================
// Chronos — Chaos Engine
// ============================================================
// Framework for injecting controlled failures into mock
// services during testing. Validates that Chronos handles
// every failure mode correctly.
//
// Chaos modes:
//   - Latency injection: random delays
//   - Error injection: forced HTTP errors
//   - Partial failure: fail N% of requests
//   - Timeout simulation: services that hang
// ============================================================

import { type MockService, type EndpointConfig } from './MockService.js';

// ── Types ──────────────────────────────────────────────────

export enum ChaosMode {
  /** No chaos — normal operation */
  NONE = 'NONE',
  /** Add random latency to responses */
  LATENCY = 'LATENCY',
  /** Force specific HTTP error codes */
  ERROR = 'ERROR',
  /** Fail a percentage of requests */
  PARTIAL_FAILURE = 'PARTIAL_FAILURE',
  /** Simulate services that hang (very long delay) */
  TIMEOUT = 'TIMEOUT',
}

export interface ChaosRule {
  /** Which chaos mode to apply */
  mode: ChaosMode;
  /** Target service name (or '*' for all) */
  targetService: string;
  /** Target endpoint path (or '*' for all) */
  targetEndpoint: string;
  /** Latency range in ms (for LATENCY mode) */
  latencyRange?: { min: number; max: number };
  /** Error status code (for ERROR mode) */
  errorStatusCode?: number;
  /** Error message (for ERROR mode) */
  errorMessage?: string;
  /** Failure probability 0-1 (for PARTIAL_FAILURE mode) */
  failureProbability?: number;
  /** Timeout duration in ms (for TIMEOUT mode) */
  timeoutMs?: number;
}

export interface ChaosEvent {
  timestamp: Date;
  rule: ChaosRule;
  service: string;
  endpoint: string;
  action: string;
}

// ── Chaos Engine ───────────────────────────────────────────

export class ChaosEngine {
  private rules: ChaosRule[] = [];
  private events: ChaosEvent[] = [];
  private _enabled = false;

  /**
   * Enable chaos mode.
   */
  enable(): void {
    this._enabled = true;
  }

  /**
   * Disable chaos mode (requests pass through normally).
   */
  disable(): void {
    this._enabled = false;
  }

  /**
   * Check if chaos is enabled.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Add a chaos rule.
   */
  addRule(rule: ChaosRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove all chaos rules.
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Get all recorded chaos events.
   */
  getEvents(): ChaosEvent[] {
    return [...this.events];
  }

  /**
   * Clear recorded events.
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Apply chaos rules to generate endpoint overrides.
   * Returns endpoint configs with chaos injected.
   */
  applyToEndpoint(
    serviceName: string,
    endpoint: EndpointConfig
  ): EndpointConfig {
    if (!this._enabled) return endpoint;

    const matchingRules = this.rules.filter((rule) =>
      this.ruleMatches(rule, serviceName, endpoint.path)
    );

    if (matchingRules.length === 0) return endpoint;

    let modified = { ...endpoint };

    for (const rule of matchingRules) {
      modified = this.injectChaos(modified, rule, serviceName);
    }

    return modified;
  }

  /**
   * Generate a chaos-injected endpoint config from a rule.
   */
  private injectChaos(
    endpoint: EndpointConfig,
    rule: ChaosRule,
    serviceName: string
  ): EndpointConfig {
    switch (rule.mode) {
      case ChaosMode.LATENCY: {
        const { min = 100, max = 2000 } = rule.latencyRange ?? {};
        const latency = Math.floor(Math.random() * (max - min) + min);
        this.recordEvent(rule, serviceName, endpoint.path, `Injected ${latency}ms latency`);
        return { ...endpoint, latencyMs: (endpoint.latencyMs ?? 0) + latency };
      }

      case ChaosMode.ERROR: {
        this.recordEvent(rule, serviceName, endpoint.path, `Forced error ${rule.errorStatusCode}`);
        return {
          ...endpoint,
          statusCode: rule.errorStatusCode ?? 500,
          responseBody: { error: rule.errorMessage ?? 'Chaos injected error' },
        };
      }

      case ChaosMode.PARTIAL_FAILURE: {
        const probability = rule.failureProbability ?? 0.5;
        this.recordEvent(rule, serviceName, endpoint.path, `Partial failure at ${probability * 100}%`);
        return {
          ...endpoint,
          failureProbability: probability,
          failureStatusCode: rule.errorStatusCode ?? 500,
        };
      }

      case ChaosMode.TIMEOUT: {
        const timeout = rule.timeoutMs ?? 60000;
        this.recordEvent(rule, serviceName, endpoint.path, `Timeout simulation ${timeout}ms`);
        return { ...endpoint, latencyMs: timeout };
      }

      default:
        return endpoint;
    }
  }

  /**
   * Check if a rule matches a service/endpoint combination.
   */
  private ruleMatches(rule: ChaosRule, serviceName: string, endpointPath: string): boolean {
    const serviceMatch = rule.targetService === '*' || rule.targetService === serviceName;
    const endpointMatch = rule.targetEndpoint === '*' || rule.targetEndpoint === endpointPath;
    return serviceMatch && endpointMatch;
  }

  /**
   * Record a chaos event for monitoring.
   */
  private recordEvent(
    rule: ChaosRule,
    service: string,
    endpoint: string,
    action: string
  ): void {
    this.events.push({
      timestamp: new Date(),
      rule,
      service,
      endpoint,
      action,
    });
  }
}

// ── Preset Scenarios ───────────────────────────────────────

/**
 * Create a chaos engine pre-configured for a specific scenario.
 */
export function createChaosScenario(scenario: 'network-jitter' | 'service-outage' | 'partial-degradation'): ChaosEngine {
  const engine = new ChaosEngine();

  switch (scenario) {
    case 'network-jitter':
      engine.addRule({
        mode: ChaosMode.LATENCY,
        targetService: '*',
        targetEndpoint: '*',
        latencyRange: { min: 50, max: 500 },
      });
      break;

    case 'service-outage':
      engine.addRule({
        mode: ChaosMode.ERROR,
        targetService: '*',
        targetEndpoint: '*',
        errorStatusCode: 503,
        errorMessage: 'Service Unavailable',
      });
      break;

    case 'partial-degradation':
      engine.addRule({
        mode: ChaosMode.PARTIAL_FAILURE,
        targetService: '*',
        targetEndpoint: '*',
        failureProbability: 0.3,
      });
      break;
  }

  engine.enable();
  return engine;
}
