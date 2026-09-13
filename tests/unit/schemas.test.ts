// ============================================================
// SagaFlow — Unit Tests: Zod Validation Schemas
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  CreateWorkflowSchema,
  CreateSagaSchema,
  WorkflowStepSchema,
  StepOperationSchema,
  RetryPolicySchema,
  SagaIdParamsSchema,
  PaginationQuerySchema,
} from '../../src/api/schemas.js';

describe('StepOperationSchema', () => {
  it('should validate a correct step operation', () => {
    const result = StepOperationSchema.safeParse({
      url: 'http://payment-service/authorize',
      method: 'POST',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(5000); // default
    }
  });

  it('should reject an invalid URL', () => {
    const result = StepOperationSchema.safeParse({
      url: 'not-a-url',
      method: 'POST',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid HTTP method', () => {
    const result = StepOperationSchema.safeParse({
      url: 'http://service/action',
      method: 'CONNECT',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional headers', () => {
    const result = StepOperationSchema.safeParse({
      url: 'http://service/action',
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
    expect(result.success).toBe(true);
  });
});

describe('WorkflowStepSchema', () => {
  it('should validate a step with action and compensation', () => {
    const result = WorkflowStepSchema.safeParse({
      name: 'reserve-inventory',
      action: {
        url: 'http://inventory-service/reserve',
        method: 'POST',
      },
      compensation: {
        url: 'http://inventory-service/release',
        method: 'POST',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should validate a step without compensation', () => {
    const result = WorkflowStepSchema.safeParse({
      name: 'send-notification',
      action: {
        url: 'http://notification-service/send',
        method: 'POST',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject step names with uppercase letters', () => {
    const result = WorkflowStepSchema.safeParse({
      name: 'Reserve-Inventory',
      action: {
        url: 'http://inventory-service/reserve',
        method: 'POST',
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty step names', () => {
    const result = WorkflowStepSchema.safeParse({
      name: '',
      action: {
        url: 'http://service/action',
        method: 'POST',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateWorkflowSchema', () => {
  const validWorkflow = {
    name: 'order-processing',
    steps: [
      {
        name: 'reserve-inventory',
        action: {
          url: 'http://inventory-service/reserve',
          method: 'POST' as const,
        },
        compensation: {
          url: 'http://inventory-service/release',
          method: 'POST' as const,
        },
      },
      {
        name: 'authorize-payment',
        action: {
          url: 'http://payment-service/authorize',
          method: 'POST' as const,
        },
        compensation: {
          url: 'http://payment-service/release',
          method: 'POST' as const,
        },
      },
    ],
  };

  it('should validate a correct workflow', () => {
    const result = CreateWorkflowSchema.safeParse(validWorkflow);
    expect(result.success).toBe(true);
  });

  it('should reject a workflow with no steps', () => {
    const result = CreateWorkflowSchema.safeParse({
      ...validWorkflow,
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject a workflow with invalid name', () => {
    const result = CreateWorkflowSchema.safeParse({
      ...validWorkflow,
      name: 'Order Processing',
    });
    expect(result.success).toBe(false);
  });

  it('should accept an optional description', () => {
    const result = CreateWorkflowSchema.safeParse({
      ...validWorkflow,
      description: 'Processes a new order through inventory and payment',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateSagaSchema', () => {
  it('should validate a correct saga creation request', () => {
    const result = CreateSagaSchema.safeParse({
      workflow: 'order-processing',
      payload: { orderId: 'ord_123', amount: 99.99 },
    });
    expect(result.success).toBe(true);
  });

  it('should default payload to empty object', () => {
    const result = CreateSagaSchema.safeParse({
      workflow: 'order-processing',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toEqual({});
    }
  });

  it('should reject missing workflow name', () => {
    const result = CreateSagaSchema.safeParse({
      payload: { orderId: 'ord_123' },
    });
    expect(result.success).toBe(false);
  });
});

describe('SagaIdParamsSchema', () => {
  it('should validate a valid UUID', () => {
    const result = SagaIdParamsSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid UUID', () => {
    const result = SagaIdParamsSchema.safeParse({
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('PaginationQuerySchema', () => {
  it('should use defaults when no values provided', () => {
    const result = PaginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should coerce string values to numbers', () => {
    const result = PaginationQuerySchema.safeParse({
      limit: '10',
      offset: '5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(5);
    }
  });

  it('should reject limit > 100', () => {
    const result = PaginationQuerySchema.safeParse({
      limit: 200,
    });
    expect(result.success).toBe(false);
  });
});

describe('RetryPolicySchema', () => {
  it('should use defaults when no values provided', () => {
    const result = RetryPolicySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxRetries).toBe(3);
      expect(result.data.baseDelayMs).toBe(100);
      expect(result.data.maxDelayMs).toBe(30000);
      expect(result.data.backoffMultiplier).toBe(2);
    }
  });

  it('should reject negative maxRetries', () => {
    const result = RetryPolicySchema.safeParse({
      maxRetries: -1,
    });
    expect(result.success).toBe(false);
  });
});
