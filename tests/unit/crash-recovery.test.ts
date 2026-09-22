// ============================================================
// Chronos — Unit Tests: Crash Recovery
// ============================================================
// Tests recovery logic using mock repositories to simulate
// various crash scenarios.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { CrashRecovery } from '../../src/recovery/CrashRecovery.js';
import {
  type SagaInstance,
  type WorkflowDefinition,
  type StepLog,
  SagaStatus,
  StepStatus,
  StepType,
} from '../../src/types/index.js';

// ── Mock Repositories ──────────────────────────────────────

class MockSagaRepository {
  public sagas: Map<string, SagaInstance> = new Map();
  public stepLogs: Map<string, StepLog[]> = new Map();
  public statusUpdates: Array<{ id: string; status: SagaStatus }> = [];

  async findUnfinished(): Promise<SagaInstance[]> {
    return [...this.sagas.values()].filter(
      (s) =>
        s.status === SagaStatus.EXECUTING ||
        s.status === SagaStatus.COMPENSATING ||
        s.status === SagaStatus.COMPENSATION_FAILED
    );
  }

  async findById(id: string): Promise<SagaInstance | null> {
    return this.sagas.get(id) ?? null;
  }

  async updateStatus(id: string, newStatus: SagaStatus, error?: string): Promise<SagaInstance> {
    const saga = this.sagas.get(id);
    if (!saga) throw new Error(`Saga not found: ${id}`);
    saga.status = newStatus;
    saga.error = error;
    this.statusUpdates.push({ id, status: newStatus });
    return saga;
  }

  async updateStepIndex(id: string, stepIndex: number): Promise<void> {
    const saga = this.sagas.get(id);
    if (saga) saga.currentStepIndex = stepIndex;
  }

  async updateContext(id: string, context: Record<string, unknown>): Promise<void> {
    const saga = this.sagas.get(id);
    if (saga) saga.context = context;
  }

  async getStepLogs(sagaId: string): Promise<StepLog[]> {
    return this.stepLogs.get(sagaId) ?? [];
  }

  async logStep(
    sagaInstanceId: string,
    stepName: string,
    stepType: StepType,
    status: StepStatus,
    _options: Record<string, unknown> = {}
  ): Promise<StepLog> {
    const log: StepLog = {
      id: `log_${Math.random().toString(36).slice(2)}`,
      sagaInstanceId,
      stepName,
      stepType,
      status,
      attempt: 1,
      createdAt: new Date(),
    };
    const logs = this.stepLogs.get(sagaInstanceId) ?? [];
    logs.push(log);
    this.stepLogs.set(sagaInstanceId, logs);
    return log;
  }

  // Helper to add test data
  addSaga(saga: SagaInstance): void {
    this.sagas.set(saga.id, saga);
  }

  addStepLogs(sagaId: string, logs: StepLog[]): void {
    this.stepLogs.set(sagaId, logs);
  }
}

class MockWorkflowRepository {
  public workflows: Map<string, WorkflowDefinition> = new Map();

  async findByNameAndVersion(name: string, _version: number): Promise<WorkflowDefinition | null> {
    return this.workflows.get(name) ?? null;
  }

  async findByName(name: string): Promise<WorkflowDefinition | null> {
    return this.workflows.get(name) ?? null;
  }

  addWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.name, workflow);
  }
}

// ── Helpers ────────────────────────────────────────────────

const makeSaga = (overrides: Partial<SagaInstance> = {}): SagaInstance => ({
  id: 'saga-test-1',
  workflowName: 'test-workflow',
  workflowVersion: 1,
  status: SagaStatus.EXECUTING,
  currentStepIndex: 0,
  payload: { orderId: 'ord_1' },
  context: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeStepLog = (overrides: Partial<StepLog> = {}): StepLog => ({
  id: `log_${Math.random().toString(36).slice(2)}`,
  sagaInstanceId: 'saga-test-1',
  stepName: 'step-0',
  stepType: StepType.ACTION,
  status: StepStatus.SUCCESS,
  attempt: 1,
  createdAt: new Date(),
  ...overrides,
});

// Note: We test the recovery logic (step log analysis, state transitions)
// without actually making HTTP calls. The engine's executeStep calls
// will fail on fake URLs, but the recovery module's decision-making
// logic is what we're testing.

describe('CrashRecovery', () => {
  let sagaRepo: MockSagaRepository;
  let workflowRepo: MockWorkflowRepository;
  let recovery: CrashRecovery;

  beforeEach(() => {
    sagaRepo = new MockSagaRepository();
    workflowRepo = new MockWorkflowRepository();
    recovery = new CrashRecovery(
      sagaRepo as unknown as import('../../src/persistence/SagaRepository.js').SagaRepository,
      workflowRepo as unknown as import('../../src/persistence/WorkflowRepository.js').WorkflowRepository,
      null // no event logger for unit tests
    );
  });

  describe('recoverAll', () => {
    it('should return empty results when no unfinished sagas', async () => {
      const result = await recovery.recoverAll();

      expect(result.totalFound).toBe(0);
      expect(result.recovered).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should skip sagas with missing workflows', async () => {
      sagaRepo.addSaga(makeSaga({ status: SagaStatus.EXECUTING }));
      // No workflow added

      const result = await recovery.recoverAll();

      expect(result.totalFound).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should not find sagas in terminal states', async () => {
      sagaRepo.addSaga(makeSaga({ id: 'completed', status: SagaStatus.COMPLETED }));
      sagaRepo.addSaga(makeSaga({ id: 'rolled-back', status: SagaStatus.ROLLED_BACK }));

      const result = await recovery.recoverAll();

      expect(result.totalFound).toBe(0);
    });
  });

  describe('recoverSaga - COMPENSATING', () => {
    it('should mark saga as ROLLED_BACK when all steps already compensated', async () => {
      const workflow: WorkflowDefinition = {
        name: 'test-workflow',
        version: 1,
        steps: [
          { name: 'step-0', action: { url: 'http://fake/a', method: 'POST' }, compensation: { url: 'http://fake/a/comp', method: 'POST' } },
          { name: 'step-1', action: { url: 'http://fake/b', method: 'POST' }, compensation: { url: 'http://fake/b/comp', method: 'POST' } },
        ],
      };
      workflowRepo.addWorkflow(workflow);

      const saga = makeSaga({ status: SagaStatus.COMPENSATING });
      sagaRepo.addSaga(saga);

      // Both steps completed ACTION and both were compensated
      sagaRepo.addStepLogs('saga-test-1', [
        makeStepLog({ stepName: 'step-0', stepType: StepType.ACTION, status: StepStatus.SUCCESS }),
        makeStepLog({ stepName: 'step-1', stepType: StepType.ACTION, status: StepStatus.SUCCESS }),
        makeStepLog({ stepName: 'step-1', stepType: StepType.COMPENSATION, status: StepStatus.COMPENSATED }),
        makeStepLog({ stepName: 'step-0', stepType: StepType.COMPENSATION, status: StepStatus.COMPENSATED }),
      ]);

      const result = await recovery.recoverSaga(saga);

      expect(result.finalStatus).toBe(SagaStatus.ROLLED_BACK);
      expect(result.action).toBe('resumed_compensation');
    });
  });

  describe('getCompletedStepIndices logic', () => {
    it('should identify completed steps from step logs', async () => {
      const workflow: WorkflowDefinition = {
        name: 'test-workflow',
        version: 1,
        steps: [
          { name: 'step-0', action: { url: 'http://fake/a', method: 'POST' } },
          { name: 'step-1', action: { url: 'http://fake/b', method: 'POST' } },
          { name: 'step-2', action: { url: 'http://fake/c', method: 'POST' } },
        ],
      };
      workflowRepo.addWorkflow(workflow);

      const saga = makeSaga({ status: SagaStatus.COMPENSATING });
      sagaRepo.addSaga(saga);

      // Steps 0 and 1 completed, step 2 failed
      sagaRepo.addStepLogs('saga-test-1', [
        makeStepLog({ stepName: 'step-0', stepType: StepType.ACTION, status: StepStatus.SUCCESS }),
        makeStepLog({ stepName: 'step-1', stepType: StepType.ACTION, status: StepStatus.SUCCESS }),
        makeStepLog({ stepName: 'step-2', stepType: StepType.ACTION, status: StepStatus.FAILED }),
      ]);

      // Recovery should attempt to compensate step-1 and step-0
      // (but will fail since URLs are fake — we just verify it tries)
      const result = await recovery.recoverSaga(saga);

      expect(result.action).toBe('resumed_compensation');
      // previousStatus was COMPENSATING when we passed it in
      // (mock updateStatus mutates in place so result reflects final state)
    });
  });
});
