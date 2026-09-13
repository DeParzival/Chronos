// ============================================================
// SagaFlow — Shared Type Definitions
// ============================================================
// Central type definitions used across the entire SagaFlow engine.
// These types define the core domain model for sagas, workflows,
// steps, and execution state.
// ============================================================

/**
 * Saga execution status.
 *
 * The lifecycle of a saga follows this state machine:
 *
 *   PENDING → EXECUTING → COMPLETED
 *                       → COMPENSATING → ROLLED_BACK
 *                                      → COMPENSATION_FAILED
 */
export enum SagaStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  COMPENSATING = 'COMPENSATING',
  ROLLED_BACK = 'ROLLED_BACK',
  COMPENSATION_FAILED = 'COMPENSATION_FAILED',
}

/**
 * Individual step execution status.
 */
export enum StepStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
  COMPENSATION_FAILED = 'COMPENSATION_FAILED',
  SKIPPED = 'SKIPPED',
}

/**
 * Step type — whether this is a forward action or a compensation.
 */
export enum StepType {
  ACTION = 'ACTION',
  COMPENSATION = 'COMPENSATION',
}

/**
 * Supported HTTP methods for step actions and compensations.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Configuration for an HTTP operation (action or compensation).
 */
export interface StepOperation {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * A single step in a workflow definition.
 *
 * Each step defines a forward action and an optional compensation
 * that semantically undoes the action.
 */
export interface WorkflowStep {
  name: string;
  action: StepOperation;
  compensation?: StepOperation;
  retryPolicy?: RetryPolicyConfig;
}

/**
 * Configuration for retry behavior on a step.
 */
export interface RetryPolicyConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * A workflow definition — the template for saga execution.
 */
export interface WorkflowDefinition {
  name: string;
  version: number;
  steps: WorkflowStep[];
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A saga instance — one concrete execution of a workflow.
 */
export interface SagaInstance {
  id: string;
  workflowName: string;
  workflowVersion: number;
  status: SagaStatus;
  currentStepIndex: number;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A log entry for a single step execution attempt.
 */
export interface StepLog {
  id: string;
  sagaInstanceId: string;
  stepName: string;
  stepType: StepType;
  status: StepStatus;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string;
  executionTimeMs?: number;
  attempt: number;
  createdAt: Date;
}

/**
 * Saga event types for the append-only event log.
 */
export enum SagaEventType {
  SAGA_STARTED = 'SAGA_STARTED',
  SAGA_COMPLETED = 'SAGA_COMPLETED',
  SAGA_FAILED = 'SAGA_FAILED',
  SAGA_COMPENSATING = 'SAGA_COMPENSATING',
  SAGA_ROLLED_BACK = 'SAGA_ROLLED_BACK',
  SAGA_COMPENSATION_FAILED = 'SAGA_COMPENSATION_FAILED',
  STEP_STARTED = 'STEP_STARTED',
  STEP_SUCCEEDED = 'STEP_SUCCEEDED',
  STEP_FAILED = 'STEP_FAILED',
  STEP_RETRYING = 'STEP_RETRYING',
  COMPENSATION_STARTED = 'COMPENSATION_STARTED',
  COMPENSATION_SUCCEEDED = 'COMPENSATION_SUCCEEDED',
  COMPENSATION_FAILED = 'COMPENSATION_FAILED',
}

/**
 * A single event in the saga's execution history.
 */
export interface SagaEvent {
  id: string;
  sagaInstanceId: string;
  eventType: SagaEventType;
  stepName?: string;
  payload?: Record<string, unknown>;
  error?: string;
  timestamp: Date;
}

/**
 * Health check response shape.
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    postgresql: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
  };
}
