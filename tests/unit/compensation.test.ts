// ============================================================
// Chronos — Unit Tests: Compensation Engine
// ============================================================
// Tests compensation logic using a mock saga repository and
// a local Fastify mock server to simulate downstream services.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { CompensationEngine } from '../../src/engine/CompensationEngine.js';
import {
  type SagaInstance,
  type WorkflowDefinition,
  SagaStatus,
  StepStatus,
  StepType,
  type StepLog,
} from '../../src/types/index.js';

// ── Mock SagaRepository ─────────────────────────────────────

class MockSagaRepository {
  public stepLogs: Array<{
    sagaId: string;
    stepName: string;
    stepType: StepType;
    status: StepStatus;
    options: Record<string, unknown>;
  }> = [];
  public statusUpdates: Array<{ id: string; status: SagaStatus; error?: string }> = [];

  async logStep(
    sagaInstanceId: string,
    stepName: string,
    stepType: StepType,
    status: StepStatus,
    options: Record<string, unknown> = {}
  ): Promise<StepLog> {
    this.stepLogs.push({
      sagaId: sagaInstanceId,
      stepName,
      stepType,
      status,
      options,
    });
    return {
      id: 'log_' + Math.random().toString(36).slice(2),
      sagaInstanceId,
      stepName,
      stepType,
      status,
      attempt: 1,
      createdAt: new Date(),
    };
  }

  async updateStatus(id: string, newStatus: SagaStatus, error?: string): Promise<SagaInstance> {
    this.statusUpdates.push({ id, status: newStatus, error });
    return {
      id,
      workflowName: 'test',
      workflowVersion: 1,
      status: newStatus,
      currentStepIndex: 0,
      payload: {},
      context: {},
      error,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  reset(): void {
    this.stepLogs = [];
    this.statusUpdates = [];
  }
}

describe('CompensationEngine', () => {
  let mockServer: FastifyInstance;
  let baseUrl: string;
  let mockRepo: MockSagaRepository;

  beforeAll(async () => {
    mockServer = Fastify({ logger: false, forceCloseConnections: true });

    mockServer.post('/compensate-success', async (_req, reply) => {
      return reply.status(200).send({ compensated: true });
    });

    mockServer.post('/compensate-failure', async (_req, reply) => {
      return reply.status(500).send({ error: 'Compensation failed' });
    });

    const address = await mockServer.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    mockRepo = new MockSagaRepository();
  });

  const makeSaga = (overrides: Partial<SagaInstance> = {}): SagaInstance => ({
    id: 'saga_test_123',
    workflowName: 'test-workflow',
    workflowVersion: 1,
    status: SagaStatus.COMPENSATING,
    currentStepIndex: 0,
    payload: { orderId: 'ord_1' },
    context: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeWorkflow = (stepCount: number, compensationUrl?: string): WorkflowDefinition => ({
    name: 'test-workflow',
    version: 1,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      name: `step-${i}`,
      action: { url: `${baseUrl}/action`, method: 'POST' as const },
      ...(compensationUrl !== undefined
        ? { compensation: { url: compensationUrl, method: 'POST' as const } }
        : {}),
    })),
  });

  it('should compensate completed steps in reverse order', async () => {
    const engine = new CompensationEngine(mockRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository);
    const saga = makeSaga();
    const workflow = makeWorkflow(3, `${baseUrl}/compensate-success`);

    // Steps 0 and 1 completed, step 2 failed
    const result = await engine.compensate(saga, workflow, [0, 1]);

    expect(result.finalStatus).toBe(SagaStatus.ROLLED_BACK);
    expect(result.compensatedSteps).toEqual(['step-1', 'step-0']);
    expect(result.failedCompensations).toHaveLength(0);

    // Verify reverse order in logs: step-1 compensated before step-0
    const compensatingLogs = mockRepo.stepLogs.filter(
      (l) => l.stepType === StepType.COMPENSATION && l.status === StepStatus.COMPENSATING
    );
    expect(compensatingLogs[0]?.stepName).toBe('step-1');
    expect(compensatingLogs[1]?.stepName).toBe('step-0');
  });

  it('should handle compensation failures and set COMPENSATION_FAILED', async () => {
    const engine = new CompensationEngine(mockRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository);
    const saga = makeSaga();
    const workflow = makeWorkflow(3, `${baseUrl}/compensate-failure`);

    const result = await engine.compensate(saga, workflow, [0, 1]);

    expect(result.finalStatus).toBe(SagaStatus.COMPENSATION_FAILED);
    expect(result.failedCompensations).toEqual(['step-1', 'step-0']);
  });

  it('should skip steps without compensation defined', async () => {
    const engine = new CompensationEngine(mockRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository);
    const saga = makeSaga();
    // No compensation URL
    const workflow = makeWorkflow(2);

    const result = await engine.compensate(saga, workflow, [0, 1]);

    expect(result.finalStatus).toBe(SagaStatus.ROLLED_BACK);
    expect(result.compensatedSteps).toHaveLength(0);

    // Should have SKIPPED logs
    const skippedLogs = mockRepo.stepLogs.filter((l) => l.status === StepStatus.SKIPPED);
    expect(skippedLogs).toHaveLength(2);
  });

  it('should handle empty completed steps (nothing to compensate)', async () => {
    const engine = new CompensationEngine(mockRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository);
    const saga = makeSaga();
    const workflow = makeWorkflow(3, `${baseUrl}/compensate-success`);

    const result = await engine.compensate(saga, workflow, []);

    expect(result.finalStatus).toBe(SagaStatus.ROLLED_BACK);
    expect(result.compensatedSteps).toHaveLength(0);
  });

  it('should persist the final status to the repository', async () => {
    const engine = new CompensationEngine(mockRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository);
    const saga = makeSaga();
    const workflow = makeWorkflow(2, `${baseUrl}/compensate-success`);

    await engine.compensate(saga, workflow, [0, 1]);

    const statusUpdate = mockRepo.statusUpdates.find((u) => u.status === SagaStatus.ROLLED_BACK);
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate?.id).toBe('saga_test_123');
  });
});
