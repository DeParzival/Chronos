// ============================================================
// Chronos — Saga Routes
// ============================================================
// REST API routes for saga lifecycle management:
//   POST   /sagas              — start a new saga
//   GET    /sagas              — list sagas (with status filter)
//   GET    /sagas/:id          — get a saga's current state
//   POST   /sagas/:id/retry    — retry a failed saga
//   POST   /sagas/:id/compensate — manually trigger compensation
//   GET    /sagas/:id/steps    — get step execution logs
// ============================================================

import { type FastifyInstance } from 'fastify';
import { type Pool } from 'pg';
import { SagaRepository } from '../../persistence/SagaRepository.js';
import { WorkflowRepository } from '../../persistence/WorkflowRepository.js';
import {
  SagaController,
  SagaNotFoundError,
  InvalidSagaOperationError,
} from '../controllers/SagaController.js';
import { WorkflowNotFoundError } from '../../engine/Orchestrator.js';
import {
  CreateSagaSchema,
  SagaIdParamsSchema,
  PaginationQuerySchema,
} from '../schemas.js';
import { SagaStatus } from '../../types/index.js';

export async function registerSagaRoutes(app: FastifyInstance): Promise<void> {
  const pool = (app as unknown as { dbPool: Pool }).dbPool;
  const sagaRepo = new SagaRepository(pool);
  const workflowRepo = new WorkflowRepository(pool);
  const controller = new SagaController(sagaRepo, workflowRepo);

  // ── POST /sagas ───────────────────────────────────────
  app.post('/sagas', async (request, reply) => {
    try {
      const parsed = CreateSagaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid saga creation request',
          details: parsed.error.issues,
        });
      }

      const { workflow, payload } = parsed.data;
      const result = await controller.startSaga(workflow, payload);

      return reply.status(201).send({
        sagaId: result.sagaId,
        status: result.status,
        message: result.status === SagaStatus.COMPLETED
          ? 'Saga completed successfully'
          : result.status === SagaStatus.COMPENSATING
            ? 'Saga failed, compensation in progress'
            : `Saga ended with status: ${result.status}`,
      });
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return reply.status(404).send({
          error: 'Workflow Not Found',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // ── GET /sagas ────────────────────────────────────────
  app.get('/sagas', async (request, reply) => {
    const paginationParsed = PaginationQuerySchema.safeParse(request.query);
    const { limit, offset } = paginationParsed.success
      ? paginationParsed.data
      : { limit: 20, offset: 0 };

    // Optional status filter
    const query = request.query as Record<string, string>;
    const statusFilter = query['status'] as SagaStatus | undefined;

    const sagas = await controller.listSagas({
      status: statusFilter && Object.values(SagaStatus).includes(statusFilter)
        ? statusFilter
        : undefined,
      limit,
      offset,
    });

    return reply.status(200).send({
      sagas: sagas.map((s) => ({
        id: s.id,
        workflowName: s.workflowName,
        workflowVersion: s.workflowVersion,
        status: s.status,
        currentStepIndex: s.currentStepIndex,
        error: s.error,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      pagination: { limit, offset, count: sagas.length },
    });
  });

  // ── GET /sagas/:id ────────────────────────────────────
  app.get('/sagas/:id', async (request, reply) => {
    const paramsParsed = SagaIdParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid saga ID format',
        details: paramsParsed.error.issues,
      });
    }

    try {
      const saga = await controller.getSaga(paramsParsed.data.id);

      return reply.status(200).send({
        id: saga.id,
        workflowName: saga.workflowName,
        workflowVersion: saga.workflowVersion,
        status: saga.status,
        currentStepIndex: saga.currentStepIndex,
        payload: saga.payload,
        context: saga.context,
        error: saga.error,
        createdAt: saga.createdAt,
        updatedAt: saga.updatedAt,
      });
    } catch (err) {
      if (err instanceof SagaNotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // ── POST /sagas/:id/retry ─────────────────────────────
  app.post('/sagas/:id/retry', async (request, reply) => {
    const paramsParsed = SagaIdParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid saga ID format',
      });
    }

    try {
      const result = await controller.retrySaga(paramsParsed.data.id);

      return reply.status(200).send({
        sagaId: result.sagaId,
        status: result.status,
        message: `Saga retry resulted in status: ${result.status}`,
      });
    } catch (err) {
      if (err instanceof SagaNotFoundError) {
        return reply.status(404).send({ error: 'Not Found', message: err.message });
      }
      if (err instanceof InvalidSagaOperationError) {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
          currentStatus: err.currentStatus,
        });
      }
      throw err;
    }
  });

  // ── POST /sagas/:id/compensate ────────────────────────
  app.post('/sagas/:id/compensate', async (request, reply) => {
    const paramsParsed = SagaIdParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid saga ID format',
      });
    }

    try {
      const result = await controller.compensateSaga(paramsParsed.data.id);

      return reply.status(200).send({
        sagaId: result.sagaId,
        status: result.status,
        message: result.status === SagaStatus.ROLLED_BACK
          ? 'Saga successfully rolled back'
          : `Compensation resulted in status: ${result.status}`,
      });
    } catch (err) {
      if (err instanceof SagaNotFoundError) {
        return reply.status(404).send({ error: 'Not Found', message: err.message });
      }
      if (err instanceof InvalidSagaOperationError) {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message,
          currentStatus: err.currentStatus,
        });
      }
      throw err;
    }
  });

  // ── GET /sagas/:id/steps ──────────────────────────────
  app.get('/sagas/:id/steps', async (request, reply) => {
    const paramsParsed = SagaIdParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid saga ID format',
      });
    }

    try {
      const steps = await controller.getSagaSteps(paramsParsed.data.id);

      return reply.status(200).send({
        sagaId: paramsParsed.data.id,
        steps: steps.map((s) => ({
          id: s.id,
          stepName: s.stepName,
          stepType: s.stepType,
          status: s.status,
          attempt: s.attempt,
          executionTimeMs: s.executionTimeMs,
          errorMessage: s.errorMessage,
          createdAt: s.createdAt,
        })),
        count: steps.length,
      });
    } catch (err) {
      if (err instanceof SagaNotFoundError) {
        return reply.status(404).send({ error: 'Not Found', message: err.message });
      }
      throw err;
    }
  });
}
