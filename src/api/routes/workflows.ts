// ============================================================
// Chronos — Workflow Routes
// ============================================================
// REST API routes for managing workflow definitions:
//   POST   /workflows       — register a new workflow
//   GET    /workflows       — list all workflows
//   GET    /workflows/:name — get a specific workflow
// ============================================================

import { type FastifyInstance } from 'fastify';
import { type Pool } from 'pg';
import { WorkflowRepository } from '../../persistence/WorkflowRepository.js';
import { WorkflowController, WorkflowValidationError, WorkflowNotFoundError } from '../controllers/WorkflowController.js';
import { CreateWorkflowSchema, PaginationQuerySchema } from '../schemas.js';

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  // Get the DB pool from the Fastify instance
  const pool = (app as unknown as { dbPool: Pool }).dbPool;
  const workflowRepo = new WorkflowRepository(pool);
  const controller = new WorkflowController(workflowRepo);

  // ── POST /workflows ───────────────────────────────────
  app.post('/workflows', async (request, reply) => {
    try {
      // Validate request body
      const parsed = CreateWorkflowSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid workflow definition',
          details: parsed.error.issues,
        });
      }

      const { name, steps, description } = parsed.data;
      const { workflow, warnings } = await controller.createWorkflow(name, steps, description);

      return reply.status(201).send({
        workflow: {
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
          steps: workflow.steps,
          createdAt: workflow.createdAt,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        return reply.status(400).send({
          error: 'Workflow Validation Error',
          message: err.message,
          details: err.validationErrors,
        });
      }
      throw err;
    }
  });

  // ── GET /workflows ────────────────────────────────────
  app.get('/workflows', async (request, reply) => {
    const parsed = PaginationQuerySchema.safeParse(request.query);
    const { limit, offset } = parsed.success
      ? parsed.data
      : { limit: 20, offset: 0 };

    const workflows = await controller.listWorkflows(limit, offset);

    return reply.status(200).send({
      workflows: workflows.map((w) => ({
        name: w.name,
        version: w.version,
        description: w.description,
        stepsCount: w.steps.length,
        createdAt: w.createdAt,
      })),
      pagination: { limit, offset, count: workflows.length },
    });
  });

  // ── GET /workflows/:name ──────────────────────────────
  app.get('/workflows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      const workflow = await controller.getWorkflow(name);

      return reply.status(200).send({
        name: workflow.name,
        version: workflow.version,
        description: workflow.description,
        steps: workflow.steps,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      });
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return reply.status(404).send({
          error: 'Not Found',
          message: err.message,
        });
      }
      throw err;
    }
  });
}
