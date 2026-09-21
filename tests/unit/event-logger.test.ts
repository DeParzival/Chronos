// ============================================================
// Chronos — Unit Tests: Event Logger
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { EventLogger } from '../../src/recovery/EventLogger.js';
import { type SagaEvent, type SagaEventType } from '../../src/types/index.js';

// ── Mock Event Repository ──────────────────────────────────

class MockEventRepository {
  public events: Array<{
    sagaId: string;
    eventType: SagaEventType;
    options: Record<string, unknown>;
  }> = [];

  async appendEvent(
    sagaInstanceId: string,
    eventType: SagaEventType,
    options: Record<string, unknown> = {}
  ): Promise<SagaEvent> {
    this.events.push({ sagaId: sagaInstanceId, eventType, options });
    return {
      id: `evt_${this.events.length}`,
      sagaInstanceId,
      eventType,
      stepName: options['stepName'] as string | undefined,
      payload: options['payload'] as Record<string, unknown> | undefined,
      error: options['error'] as string | undefined,
      timestamp: new Date(),
    };
  }
}

describe('EventLogger', () => {
  let mockRepo: MockEventRepository;
  let logger: EventLogger;

  beforeEach(() => {
    mockRepo = new MockEventRepository();
    logger = new EventLogger(
      mockRepo as unknown as import('../../src/persistence/EventRepository.js').EventRepository
    );
  });

  // ── Saga lifecycle ────────────────────────────────────

  it('should log SAGA_STARTED with workflow name and payload', async () => {
    await logger.sagaStarted('saga-1', 'place-order', { orderId: 'ord_1' });

    expect(mockRepo.events).toHaveLength(1);
    expect(mockRepo.events[0]?.eventType).toBe('SAGA_STARTED');
    expect(mockRepo.events[0]?.sagaId).toBe('saga-1');
  });

  it('should log SAGA_COMPLETED', async () => {
    await logger.sagaCompleted('saga-1');

    expect(mockRepo.events[0]?.eventType).toBe('SAGA_COMPLETED');
  });

  it('should log SAGA_ROLLED_BACK', async () => {
    await logger.sagaRolledBack('saga-1');

    expect(mockRepo.events[0]?.eventType).toBe('SAGA_ROLLED_BACK');
  });

  it('should log SAGA_COMPENSATION_FAILED with error', async () => {
    await logger.sagaCompensationFailed('saga-1', 'Payment refund failed');

    expect(mockRepo.events[0]?.eventType).toBe('SAGA_COMPENSATION_FAILED');
    expect(mockRepo.events[0]?.options['error']).toBe('Payment refund failed');
  });

  // ── Step execution ────────────────────────────────────

  it('should log STEP_STARTED with step name', async () => {
    await logger.stepStarted('saga-1', 'charge-payment');

    expect(mockRepo.events[0]?.eventType).toBe('STEP_STARTED');
    expect(mockRepo.events[0]?.options['stepName']).toBe('charge-payment');
  });

  it('should log STEP_SUCCEEDED with response', async () => {
    await logger.stepSucceeded('saga-1', 'charge-payment', { txId: 'tx_123' });

    expect(mockRepo.events[0]?.eventType).toBe('STEP_SUCCEEDED');
  });

  it('should log STEP_FAILED with error', async () => {
    await logger.stepFailed('saga-1', 'charge-payment', 'Insufficient funds');

    expect(mockRepo.events[0]?.eventType).toBe('STEP_FAILED');
    expect(mockRepo.events[0]?.options['error']).toBe('Insufficient funds');
  });

  // ── Compensation ──────────────────────────────────────

  it('should log COMPENSATION_STARTED', async () => {
    await logger.compensationStarted('saga-1', 'charge-payment');

    expect(mockRepo.events[0]?.eventType).toBe('COMPENSATION_STARTED');
  });

  it('should log COMPENSATION_SUCCEEDED', async () => {
    await logger.compensationSucceeded('saga-1', 'charge-payment');

    expect(mockRepo.events[0]?.eventType).toBe('COMPENSATION_SUCCEEDED');
  });

  it('should log COMPENSATION_FAILED', async () => {
    await logger.compensationFailed('saga-1', 'charge-payment', 'Refund service down');

    expect(mockRepo.events[0]?.eventType).toBe('COMPENSATION_FAILED');
  });

  // ── Recovery ──────────────────────────────────────────

  it('should log RECOVERY_STARTED', async () => {
    await logger.recoveryStarted('saga-1', 'EXECUTING');

    expect(mockRepo.events[0]?.eventType).toBe('RECOVERY_STARTED');
  });

  it('should log RECOVERY_COMPLETED', async () => {
    await logger.recoveryCompleted('saga-1', 'COMPLETED');

    expect(mockRepo.events[0]?.eventType).toBe('RECOVERY_COMPLETED');
  });

  // ── Multiple events ───────────────────────────────────

  it('should record multiple events in sequence', async () => {
    await logger.sagaStarted('saga-1', 'order', {});
    await logger.stepStarted('saga-1', 'payment');
    await logger.stepSucceeded('saga-1', 'payment');
    await logger.sagaCompleted('saga-1');

    expect(mockRepo.events).toHaveLength(4);
    expect(mockRepo.events.map((e) => e.eventType)).toEqual([
      'SAGA_STARTED',
      'STEP_STARTED',
      'STEP_SUCCEEDED',
      'SAGA_COMPLETED',
    ]);
  });
});
