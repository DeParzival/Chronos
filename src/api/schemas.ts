// ============================================================
// SagaFlow — Zod Validation Schemas
// ============================================================
// Defines runtime validation schemas for workflow definitions,
// saga creation requests, and API inputs. These schemas ensure
// that invalid data never reaches the saga execution engine.
// ============================================================

import { z } from 'zod';

// ── HTTP Method ─────────────────────────────────────────────

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// ── Step Operation (action or compensation) ─────────────────

export const StepOperationSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  method: HttpMethodSchema,
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(60000).optional().default(5000),
});

// ── Retry Policy ────────────────────────────────────────────

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  baseDelayMs: z.number().int().positive().max(30000).default(100),
  maxDelayMs: z.number().int().positive().max(300000).default(30000),
  backoffMultiplier: z.number().positive().max(10).default(2),
});

// ── Workflow Step ───────────────────────────────────────────

export const WorkflowStepSchema = z.object({
  name: z
    .string()
    .min(1, 'Step name is required')
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Step name must be lowercase alphanumeric with hyphens'),
  action: StepOperationSchema,
  compensation: StepOperationSchema.optional(),
  retryPolicy: RetryPolicySchema.optional(),
});

// ── Workflow Definition ─────────────────────────────────────

export const CreateWorkflowSchema = z.object({
  name: z
    .string()
    .min(1, 'Workflow name is required')
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Workflow name must be lowercase alphanumeric with hyphens'),
  description: z.string().max(1000).optional(),
  steps: z
    .array(WorkflowStepSchema)
    .min(1, 'Workflow must have at least one step')
    .max(50, 'Workflow cannot exceed 50 steps'),
});

// ── Saga Creation ───────────────────────────────────────────

export const CreateSagaSchema = z.object({
  workflow: z.string().min(1, 'Workflow name is required'),
  payload: z.record(z.unknown()).default({}),
});

// ── Path Parameters ─────────────────────────────────────────

export const SagaIdParamsSchema = z.object({
  id: z.string().uuid('Saga ID must be a valid UUID'),
});

// ── Query Parameters ────────────────────────────────────────

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Inferred Types ──────────────────────────────────────────

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
export type CreateSagaInput = z.infer<typeof CreateSagaSchema>;
export type SagaIdParams = z.infer<typeof SagaIdParamsSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
