# Phase 1 — Foundation & Infrastructure

## Overview

Phase 1 establishes the entire project foundation upon which all subsequent phases will build. This includes the TypeScript toolchain, Fastify HTTP server, PostgreSQL and Redis connectivity, Docker containerization, validation schemas, and the testing framework.

No business logic is implemented in this phase — the goal is a robust, correctly configured, and fully containerized development environment.

---

## Commits in This Phase

| # | Commit Message |
|---|----------------|
| 1 | `feat: initialize TypeScript project with package.json, tsconfig, and project structure` |
| 2 | `feat: add Fastify server with health check endpoint and Zod validation setup` |
| 3 | `feat: add PostgreSQL and Redis connection modules with configuration` |
| 4 | `feat: add Docker Compose with SagaFlow, PostgreSQL, Redis, and mock services` |

---

## 1. TypeScript Project Initialization

### What

We initialize a Node.js project with TypeScript as the primary language. TypeScript provides static typing which is critical for a distributed systems project where incorrect types can lead to subtle, hard-to-debug runtime failures.

### Why TypeScript?

SagaFlow deals with complex state machines, workflow definitions, execution results, and database models. Without static typing:

- A saga status could accidentally be set to an invalid string
- A workflow step might be missing required compensation configuration
- An API response might have an unexpected shape

TypeScript catches these errors at compile time rather than at runtime (potentially in production, potentially during a distributed transaction).

### Key Configuration

**`tsconfig.json`** is configured with:
- `strict: true` — enables all strict type-checking options
- `target: ES2022` — modern JavaScript features (top-level await, etc.)
- `module: NodeNext` — Node.js ESM module resolution
- `outDir: ./dist` — compiled output directory
- `rootDir: ./src` — source directory

**`package.json`** includes:
- `type: "module"` — ESM modules throughout
- Scripts for `build`, `dev`, `start`, `test`, `lint`
- Development dependencies: `typescript`, `tsx` (for dev mode), `vitest`

### Project Structure

```
sagaflow/
├── src/
│   ├── api/
│   │   ├── routes/          # Fastify route definitions
│   │   └── controllers/     # Request handlers
│   ├── engine/              # Saga execution engine (Phase 2)
│   ├── workflow/            # Workflow definition & validation (Phase 2)
│   ├── transport/           # HTTP client & retry logic (Phase 4)
│   ├── persistence/         # Database repositories (Phase 2)
│   ├── recovery/            # Crash recovery (Phase 5)
│   ├── coordination/        # Distributed leases (Phase 6)
│   ├── config/              # Configuration management
│   │   └── index.ts
│   ├── types/               # Shared TypeScript types
│   │   └── index.ts
│   └── server.ts            # Application entry point
├── tests/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── chaos/               # Chaos/failure tests
├── services/                # Mock microservices (Phase 8)
│   ├── payment-service/
│   ├── inventory-service/
│   └── shipping-service/
├── docs/                    # Phase documentation
├── docker-compose.yml
├── Dockerfile
├── .dockerignore
├── .gitignore
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 2. Fastify Server & Health Check

### What

Fastify is configured as the HTTP framework with a `/health` endpoint that reports the status of all dependencies.

### Why Fastify?

Fastify was chosen over Express for several reasons:

1. **Performance** — Fastify is one of the fastest Node.js HTTP frameworks, using a radix tree for route matching
2. **Schema validation** — Built-in JSON Schema support integrates well with Zod
3. **Plugin system** — Clean plugin architecture for organizing routes, database connections, etc.
4. **TypeScript support** — First-class TypeScript support with typed route handlers
5. **Lifecycle hooks** — `onRequest`, `preHandler`, `onResponse` hooks for middleware patterns

### Health Check Endpoint

The `/health` endpoint is not just a simple `200 OK`. It checks:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-13T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "postgresql": "connected",
    "redis": "connected"
  }
}
```

This is critical for:
- Docker health checks
- Kubernetes readiness/liveness probes
- Load balancer health monitoring
- Quick debugging of connection issues

### Zod Validation

Zod is integrated as the validation layer for all API inputs. Every request body, query parameter, and path parameter is validated through Zod schemas before reaching the handler.

Example pattern:
```typescript
const CreateSagaSchema = z.object({
  workflow: z.string().min(1),
  payload: z.record(z.unknown())
});
```

This ensures that invalid data never reaches the saga engine.

---

## 3. PostgreSQL & Redis Connections

### What

Connection modules for PostgreSQL (via `pg` / node-postgres) and Redis (via `ioredis`) with proper connection pooling, error handling, and graceful shutdown.

### PostgreSQL — Why and How

PostgreSQL serves as the **durable persistence layer**. Every piece of saga state that must survive a process crash is stored in PostgreSQL:

- Saga instances and their current status
- Workflow definitions and versions
- Step execution logs
- Event history (write-ahead log)
- Idempotency keys
- Dead-letter entries

**Connection Pool:** We use `pg.Pool` with configurable pool size. The pool maintains a set of reusable connections, avoiding the overhead of establishing a new connection for every query.

Key configuration:
- `max`: Maximum pool size (default: 20)
- `idleTimeoutMillis`: How long idle connections are kept (default: 30000)
- `connectionTimeoutMillis`: Timeout for acquiring a connection (default: 5000)

**Why not an ORM?** SagaFlow uses raw SQL queries via `pg` rather than an ORM like Prisma or TypeORM because:
1. The queries involve complex transactional logic (BEGIN/COMMIT/ROLLBACK)
2. We need fine-grained control over transaction isolation levels
3. The data model is relatively simple — the complexity is in the orchestration logic
4. Raw SQL is more predictable for debugging distributed transaction behavior

### Redis — Why and How

Redis serves as the **fast coordination layer**. It complements PostgreSQL for use cases where speed and atomicity of simple operations matter more than complex queries:

- **Distributed locks/leases** — Preventing concurrent execution of the same saga across multiple SagaFlow instances
- **Caching** — Frequently accessed workflow definitions
- **Rate limiting** — Throttling requests to downstream services
- **Circuit breaker state** — Tracking failure counts for services

**ioredis** is chosen over the `redis` package because:
1. Better reconnection handling
2. Lua scripting support (needed for atomic lease operations)
3. Cluster support for production deployments
4. Better TypeScript types

### Graceful Shutdown

Both connections implement graceful shutdown:

```
SIGTERM/SIGINT received
       ↓
Stop accepting new requests
       ↓
Wait for in-flight requests to complete
       ↓
Close Redis connection
       ↓
Drain PostgreSQL pool
       ↓
Exit process
```

This prevents connection leaks and ensures in-flight transactions are not abruptly terminated.

---

## 4. Docker Compose Environment

### What

A complete Docker Compose configuration that runs SagaFlow alongside PostgreSQL, Redis, and placeholder mock microservices.

### Why Docker?

SagaFlow is a distributed systems project. To test it properly, you need:
- A PostgreSQL database
- A Redis instance
- Multiple mock services (payment, inventory, shipping)
- Potentially multiple SagaFlow instances

Running all of this natively would require installing and configuring each service. Docker Compose provides:
1. **Reproducibility** — Same environment on any machine
2. **Isolation** — Services don't interfere with system-level installations
3. **Networking** — Docker Compose creates a shared network for service-to-service communication
4. **One command** — `docker compose up` starts everything

### Services Defined

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `sagaflow` | Custom (Dockerfile) | 3000 | The orchestration engine |
| `postgres` | postgres:16-alpine | 5432 | Durable persistence |
| `redis` | redis:7-alpine | 6379 | Coordination & caching |
| `payment-service` | Custom (Phase 8) | 4001 | Mock payment service |
| `inventory-service` | Custom (Phase 8) | 4002 | Mock inventory service |
| `shipping-service` | Custom (Phase 8) | 4003 | Mock shipping service |

### Dockerfile

The SagaFlow Dockerfile uses a **multi-stage build**:

1. **Build stage** — Install dependencies, compile TypeScript
2. **Production stage** — Copy only compiled output and production dependencies

This keeps the final image small by excluding dev dependencies, TypeScript source, and build tools.

### Environment Variables

All configuration is driven by environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Fastify server port | 3000 |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | — |
| `LOG_LEVEL` | Logging verbosity | info |
| `NODE_ENV` | Environment (development/production) | development |

A `.env.example` file documents all available variables.

---

## 5. Vitest Test Setup

### What

Vitest is configured as the test runner with separate configurations for unit, integration, and chaos tests.

### Why Vitest?

1. **Native ESM support** — Works with our `type: "module"` configuration
2. **TypeScript support** — No additional configuration needed
3. **Fast** — Uses Vite's transformation pipeline
4. **Compatible API** — Jest-compatible API, easy migration
5. **Watch mode** — Fast feedback loop during development

### Test Categories

- **Unit tests** (`tests/unit/`) — Test individual modules in isolation (state machine, validation, retry logic)
- **Integration tests** (`tests/integration/`) — Test modules working together with real database/Redis
- **Chaos tests** (`tests/chaos/`) — Test system behavior under failures (Phase 8)

---

## Services & Technologies Summary

| Technology | Role in Phase 1 |
|-----------|-----------------|
| TypeScript | Static typing, compile-time safety |
| Node.js | Async I/O runtime for network-bound orchestration |
| Fastify | HTTP framework with plugin architecture |
| Zod | Runtime validation of API inputs and configurations |
| PostgreSQL | Durable state storage (connection setup) |
| Redis | Fast coordination layer (connection setup) |
| Docker | Containerized development environment |
| Docker Compose | Multi-service orchestration for local development |
| Vitest | Testing framework for unit/integration/chaos tests |
| tsx | TypeScript execution for development (no compile step) |

---

## What Phase 1 Does NOT Include

- No saga execution logic (Phase 2)
- No workflow definitions (Phase 2)
- No REST API beyond health check (Phase 3)
- No retry/timeout logic (Phase 4)
- No crash recovery (Phase 5)
- No distributed coordination (Phase 6)

Phase 1 is purely about having a solid, correctly configured, fully containerized foundation.
