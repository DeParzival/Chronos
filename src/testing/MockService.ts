// ============================================================
// Chronos — Mock Microservice
// ============================================================
// Configurable Fastify-based mock service for testing.
// Simulates downstream services (payment, inventory, etc.)
// with controllable response behavior.
//
// Features:
//   - Configurable status codes and response bodies
//   - Configurable latency (simulate slow services)
//   - Request recording for test assertions
//   - Random failure injection
//   - Multiple endpoint support
// ============================================================

import Fastify, { type FastifyInstance } from 'fastify';

// ── Types ──────────────────────────────────────────────────

export interface EndpointConfig {
  /** HTTP method (default: 'POST') */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Route path (e.g., '/charge') */
  path: string;
  /** Response status code (default: 200) */
  statusCode?: number;
  /** Response body */
  responseBody?: Record<string, unknown>;
  /** Simulated latency in ms (default: 0) */
  latencyMs?: number;
  /** Probability of failure (0-1, default: 0 = never) */
  failureProbability?: number;
  /** Status code to return on failure (default: 500) */
  failureStatusCode?: number;
  /** Custom handler override */
  handler?: (req: RecordedRequest) => { statusCode: number; body: Record<string, unknown> };
}

export interface MockServiceConfig {
  /** Service name for logging */
  name: string;
  /** Endpoints to register */
  endpoints: EndpointConfig[];
  /** Host to bind to (default: '127.0.0.1') */
  host?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  timestamp: Date;
  endpointPath: string;
}

// ── Mock Service ───────────────────────────────────────────

export class MockService {
  private server: FastifyInstance | null = null;
  private _requests: RecordedRequest[] = [];
  private _url: string = '';
  public readonly name: string;
  private readonly config: MockServiceConfig;

  constructor(config: MockServiceConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * Start the mock service on a random port.
   */
  async start(): Promise<string> {
    this.server = Fastify({ logger: false, forceCloseConnections: true });

    // Disable content-type parsing to accept any payload
    this.server.removeAllContentTypeParsers();
    this.server.addContentTypeParser('*', (_req, payload, done) => {
      let data = '';
      payload.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      payload.on('end', () => {
        try { done(null, JSON.parse(data)); }
        catch { done(null, data || null); }
      });
    });

    // Register endpoints
    for (const endpoint of this.config.endpoints) {
      this.registerEndpoint(endpoint);
    }

    const host = this.config.host ?? '127.0.0.1';
    this._url = await this.server.listen({ port: 0, host });
    return this._url;
  }

  /**
   * Stop the mock service.
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }

  /**
   * Get the base URL of the running service.
   */
  get url(): string {
    return this._url;
  }

  /**
   * Get all recorded requests.
   */
  get requests(): RecordedRequest[] {
    return [...this._requests];
  }

  /**
   * Get requests to a specific endpoint.
   */
  getRequestsTo(path: string): RecordedRequest[] {
    return this._requests.filter((r) => r.endpointPath === path);
  }

  /**
   * Clear recorded requests.
   */
  clearRequests(): void {
    this._requests = [];
  }

  /**
   * Get total request count.
   */
  get requestCount(): number {
    return this._requests.length;
  }

  // ── Private ───────────────────────────────────────────

  private registerEndpoint(config: EndpointConfig): void {
    const method = (config.method ?? 'POST').toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    const statusCode = config.statusCode ?? 200;
    const responseBody = config.responseBody ?? { success: true };
    const latencyMs = config.latencyMs ?? 0;
    const failureProbability = config.failureProbability ?? 0;
    const failureStatusCode = config.failureStatusCode ?? 500;

    this.server![method](config.path, async (req, reply) => {
      // Record the request
      const recorded: RecordedRequest = {
        method: req.method,
        path: req.url,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
        timestamp: new Date(),
        endpointPath: config.path,
      };
      this._requests.push(recorded);

      // Simulate latency
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }

      // Random failure injection
      if (failureProbability > 0 && Math.random() < failureProbability) {
        return reply.status(failureStatusCode).send({
          error: 'Injected failure',
          service: this.name,
        });
      }

      // Custom handler
      if (config.handler) {
        const result = config.handler(recorded);
        return reply.status(result.statusCode).send(result.body);
      }

      // Default response
      return reply.status(statusCode).send(responseBody);
    });
  }
}

// ── Factory Functions ──────────────────────────────────────

/**
 * Create a mock payment service.
 */
export function createPaymentService(overrides: Partial<EndpointConfig> = {}): MockService {
  return new MockService({
    name: 'payment-service',
    endpoints: [
      {
        path: '/charge',
        responseBody: { transactionId: `tx_${Date.now()}`, status: 'charged' },
        ...overrides,
      },
      {
        path: '/refund',
        responseBody: { refundId: `ref_${Date.now()}`, status: 'refunded' },
        ...overrides,
      },
    ],
  });
}

/**
 * Create a mock inventory service.
 */
export function createInventoryService(overrides: Partial<EndpointConfig> = {}): MockService {
  return new MockService({
    name: 'inventory-service',
    endpoints: [
      {
        path: '/reserve',
        responseBody: { reservationId: `res_${Date.now()}`, status: 'reserved' },
        ...overrides,
      },
      {
        path: '/release',
        responseBody: { status: 'released' },
        ...overrides,
      },
    ],
  });
}

/**
 * Create a mock shipping service.
 */
export function createShippingService(overrides: Partial<EndpointConfig> = {}): MockService {
  return new MockService({
    name: 'shipping-service',
    endpoints: [
      {
        path: '/schedule',
        responseBody: { shipmentId: `ship_${Date.now()}`, status: 'scheduled' },
        ...overrides,
      },
      {
        path: '/cancel',
        responseBody: { status: 'cancelled' },
        ...overrides,
      },
    ],
  });
}
