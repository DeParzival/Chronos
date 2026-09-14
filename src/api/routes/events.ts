// ============================================================
// Chronos — Event History Routes
// ============================================================
// REST API route for saga event history:
//   GET /sagas/:id/history — full event timeline
// ============================================================

import { type FastifyInstance } from 'fastify';
import { type Pool } from 'pg';
import { EventRepository } from '../../persistence/EventRepository.js';
import { SagaRepository } from '../../persistence/SagaRepository.js';
import { SagaIdParamsSchema } from '../schemas.js';

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const pool = (app as unknown as { dbPool: Pool }).dbPool;
  const eventRepo = new EventRepository(pool);
  const sagaRepo = new SagaRepository(pool);

  // ── GET /sagas/:id/history ────────────────────────────
  app.get('/sagas/:id/history', async (request, reply) => {
    const paramsParsed = SagaIdParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid saga ID format',
      });
    }

    const sagaId = paramsParsed.data.id;

    // Verify saga exists
    const saga = await sagaRepo.findById(sagaId);
    if (!saga) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Saga "${sagaId}" not found`,
      });
    }

    const events = await eventRepo.getEventsBySagaId(sagaId);

    return reply.status(200).send({
      sagaId,
      status: saga.status,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        stepName: e.stepName,
        error: e.error,
        timestamp: e.timestamp,
      })),
      count: events.length,
    });
  });
}
