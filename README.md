# SagaFlow

A crash-resilient distributed transaction & workflow orchestration engine implementing the Saga pattern.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start with Docker Compose
docker compose up -d

# Run in development mode
npm run dev

# Run tests
npm test
```

## Tech Stack

- **TypeScript** — Static typing for workflow definitions and state machines
- **Node.js** — Async I/O runtime for network-bound orchestration
- **Fastify** — High-performance HTTP framework
- **PostgreSQL** — Durable saga state persistence
- **Redis** — Distributed coordination and caching
- **Zod** — Runtime schema validation
- **Vitest** — Testing framework
- **Docker** — Containerized development environment

## Architecture

```
┌───────────────────────────────────────────┐
│                  API Layer                │
│              Fastify / REST               │
├───────────────────────────────────────────┤
│              Workflow Layer               │
│        DSL / Validation / DAG             │
├───────────────────────────────────────────┤
│             Execution Layer               │
│       Scheduler / State Machine           │
│       Retry / Compensation / Timeout      │
├───────────────────────────────────────────┤
│             Reliability Layer             │
│   Idempotency / Recovery / Leases / DLQ   │
├───────────────────────────────────────────┤
│             Persistence Layer             │
│        PostgreSQL + Redis                 │
└───────────────────────────────────────────┘
```

## License

MIT
