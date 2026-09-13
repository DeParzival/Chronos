// ============================================================
// Chronos — Workflow Repository
// ============================================================
// Persists workflow definitions in PostgreSQL.
//
// Workflows are versioned — updating a workflow creates a new
// version rather than overwriting the old one. This ensures
// in-flight sagas continue using the version they started with.
// ============================================================

import { type Pool } from 'pg';
import { type WorkflowDefinition, type WorkflowStep } from '../types/index.js';

export class WorkflowRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new workflow or a new version of an existing one.
   *
   * If a workflow with the same name exists, the version is
   * auto-incremented. Otherwise, it starts at version 1.
   */
  async create(
    name: string,
    steps: WorkflowStep[],
    description?: string
  ): Promise<WorkflowDefinition> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get the latest version for this workflow name
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM workflows WHERE name = $1`,
        [name]
      );
      const nextVersion = versionResult.rows[0]?.next_version as number;

      // Insert the new workflow version
      const insertResult = await client.query(
        `INSERT INTO workflows (name, version, description, steps)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, version, description, steps, created_at, updated_at`,
        [name, nextVersion, description ?? null, JSON.stringify(steps)]
      );

      await client.query('COMMIT');

      const row = insertResult.rows[0];
      return this.mapRow(row);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get the latest version of a workflow by name.
   */
  async findByName(name: string): Promise<WorkflowDefinition | null> {
    const result = await this.pool.query(
      `SELECT id, name, version, description, steps, created_at, updated_at
       FROM workflows
       WHERE name = $1
       ORDER BY version DESC
       LIMIT 1`,
      [name]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Get a specific version of a workflow.
   */
  async findByNameAndVersion(
    name: string,
    version: number
  ): Promise<WorkflowDefinition | null> {
    const result = await this.pool.query(
      `SELECT id, name, version, description, steps, created_at, updated_at
       FROM workflows
       WHERE name = $1 AND version = $2`,
      [name, version]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * List all workflows (latest version of each), paginated.
   */
  async list(limit = 20, offset = 0): Promise<WorkflowDefinition[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (name)
              id, name, version, description, steps, created_at, updated_at
       FROM workflows
       ORDER BY name, version DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Map a database row to a WorkflowDefinition.
   */
  private mapRow(row: Record<string, unknown>): WorkflowDefinition {
    return {
      name: row.name as string,
      version: row.version as number,
      description: (row.description as string) ?? undefined,
      steps: row.steps as WorkflowStep[],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
