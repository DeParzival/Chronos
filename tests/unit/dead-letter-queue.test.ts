// ============================================================
// Chronos — Unit Tests: Dead Letter Queue
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { DeadLetterQueue, type DeadLetterEntry } from '../../src/reliability/DeadLetterQueue.js';

// ── Mock Pool ──────────────────────────────────────────────

class MockPool {
  public entries: DeadLetterEntry[] = [];
  private nextId = 1;

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const trimmed = sql.replace(/\s+/g, ' ').trim();

    // INSERT
    if (trimmed.startsWith('INSERT INTO dead_letter_queue')) {
      const entry: DeadLetterEntry = {
        id: `dlq_${this.nextId++}`,
        sagaId: params![0] as string,
        workflowName: params![1] as string,
        error: params![2] as string,
        payload: JSON.parse(params![3] as string),
        context: JSON.parse(params![4] as string),
        retryCount: params![5] as number,
        acknowledged: false,
        createdAt: new Date(),
        acknowledgedAt: null,
      };
      this.entries.push(entry);
      return { rows: [this.toRow(entry)], rowCount: 1 };
    }

    // UPDATE acknowledge by saga ID (check BEFORE id-based to avoid collision)
    if (trimmed.startsWith('UPDATE') && trimmed.includes('saga_instance_id')) {
      let count = 0;
      for (const entry of this.entries) {
        if (entry.sagaId === params![0] && !entry.acknowledged) {
          entry.acknowledged = true;
          entry.acknowledgedAt = new Date();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    // UPDATE acknowledge by ID
    if (trimmed.startsWith('UPDATE') && trimmed.includes('WHERE id')) {
      const entry = this.entries.find((e) => e.id === params![0] && !e.acknowledged);
      if (entry) {
        entry.acknowledged = true;
        entry.acknowledgedAt = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // DELETE purge
    if (trimmed.startsWith('DELETE')) {
      const before = this.entries.length;
      this.entries = this.entries.filter(
        (e) => !e.acknowledged || !e.acknowledgedAt || e.acknowledgedAt >= (params![0] as Date)
      );
      return { rows: [], rowCount: before - this.entries.length };
    }

    // Stats (SELECT with COUNT)
    if (trimmed.includes('COUNT(*)')) {
      const total = this.entries.length;
      const unacknowledged = this.entries.filter((e) => !e.acknowledged).length;
      const acknowledged = this.entries.filter((e) => e.acknowledged).length;
      return { rows: [{ total, unacknowledged, acknowledged }], rowCount: 1 };
    }

    // SELECT unacknowledged (has LIMIT)
    if (trimmed.includes('acknowledged = false') && trimmed.includes('LIMIT')) {
      const unack = this.entries.filter((e) => !e.acknowledged);
      const limit = params![0] as number;
      const offset = params![1] as number;
      return { rows: unack.slice(offset, offset + limit).map((e) => this.toRow(e)), rowCount: 0 };
    }

    // SELECT by saga ID
    if (trimmed.includes('saga_instance_id') && trimmed.startsWith('SELECT')) {
      const found = this.entries.filter((e) => e.sagaId === params![0]);
      return { rows: found.map((e) => this.toRow(e)), rowCount: found.length };
    }

    // SELECT by ID
    if (trimmed.includes('WHERE id') && trimmed.startsWith('SELECT')) {
      const found = this.entries.filter((e) => e.id === params![0]);
      return { rows: found.map((e) => this.toRow(e)), rowCount: found.length };
    }

    return { rows: [], rowCount: 0 };
  }

  private toRow(entry: DeadLetterEntry): Record<string, unknown> {
    return {
      id: entry.id,
      saga_instance_id: entry.sagaId,
      workflow_name: entry.workflowName,
      error: entry.error,
      payload: entry.payload,
      context: entry.context,
      retry_count: entry.retryCount,
      acknowledged: entry.acknowledged,
      created_at: entry.createdAt.toISOString(),
      acknowledged_at: entry.acknowledgedAt?.toISOString() ?? null,
    };
  }
}

describe('DeadLetterQueue', () => {
  let mockPool: MockPool;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    mockPool = new MockPool();
    dlq = new DeadLetterQueue(mockPool as unknown as import('pg').Pool);
  });

  it('should enqueue a failed saga', async () => {
    const entry = await dlq.enqueue(
      'saga-1', 'order-workflow', 'Payment failed', { orderId: 'ord_1' }, {}, 3
    );

    expect(entry.sagaId).toBe('saga-1');
    expect(entry.workflowName).toBe('order-workflow');
    expect(entry.error).toBe('Payment failed');
    expect(entry.retryCount).toBe(3);
    expect(entry.acknowledged).toBe(false);
  });

  it('should find entry by ID', async () => {
    const entry = await dlq.enqueue('saga-1', 'wf', 'err', {}, {}, 0);
    const found = await dlq.findById(entry.id);

    expect(found).not.toBeNull();
    expect(found!.sagaId).toBe('saga-1');
  });

  it('should return null for unknown ID', async () => {
    const found = await dlq.findById('nonexistent');
    expect(found).toBeNull();
  });

  it('should find unacknowledged entries', async () => {
    await dlq.enqueue('saga-1', 'wf', 'err1', {}, {}, 0);
    await dlq.enqueue('saga-2', 'wf', 'err2', {}, {}, 0);

    const unack = await dlq.findUnacknowledged();
    expect(unack).toHaveLength(2);
  });

  it('should acknowledge an entry', async () => {
    const entry = await dlq.enqueue('saga-1', 'wf', 'err', {}, {}, 0);
    const result = await dlq.acknowledge(entry.id);

    expect(result).toBe(true);

    const unack = await dlq.findUnacknowledged();
    expect(unack).toHaveLength(0);
  });

  it('should not acknowledge already acknowledged entry', async () => {
    const entry = await dlq.enqueue('saga-1', 'wf', 'err', {}, {}, 0);
    await dlq.acknowledge(entry.id);
    const result = await dlq.acknowledge(entry.id);

    expect(result).toBe(false);
  });

  it('should acknowledge all entries for a saga', async () => {
    await dlq.enqueue('saga-1', 'wf', 'err1', {}, {}, 0);
    await dlq.enqueue('saga-1', 'wf', 'err2', {}, {}, 1);
    await dlq.enqueue('saga-2', 'wf', 'err3', {}, {}, 0);

    const count = await dlq.acknowledgeBySagaId('saga-1');
    expect(count).toBe(2);

    const unack = await dlq.findUnacknowledged();
    expect(unack).toHaveLength(1);
  });

  it('should return stats', async () => {
    await dlq.enqueue('saga-1', 'wf', 'err1', {}, {}, 0);
    await dlq.enqueue('saga-2', 'wf', 'err2', {}, {}, 0);
    const entry3 = await dlq.enqueue('saga-3', 'wf', 'err3', {}, {}, 0);
    await dlq.acknowledge(entry3.id);

    const stats = await dlq.getStats();
    expect(stats.total).toBe(3);
    expect(stats.unacknowledged).toBe(2);
    expect(stats.acknowledged).toBe(1);
  });

  it('should find entries by saga ID', async () => {
    await dlq.enqueue('saga-1', 'wf', 'err1', {}, {}, 0);
    await dlq.enqueue('saga-1', 'wf', 'err2', {}, {}, 1);
    await dlq.enqueue('saga-2', 'wf', 'err3', {}, {}, 0);

    const entries = await dlq.findBySagaId('saga-1');
    expect(entries).toHaveLength(2);
  });
});
