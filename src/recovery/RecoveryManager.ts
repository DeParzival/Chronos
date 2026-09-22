// ============================================================
// Chronos — Recovery Manager
// ============================================================
// Integrates crash recovery into the application startup.
// Provides a startup hook that runs recovery before the
// server starts accepting requests.
//
// Also handles compensation-specific recovery: sagas stuck
// in COMPENSATING or COMPENSATION_FAILED states get their
// remaining compensations re-attempted.
// ============================================================

import { type Pool } from 'pg';
import { SagaRepository } from '../persistence/SagaRepository.js';
import { WorkflowRepository } from '../persistence/WorkflowRepository.js';
import { EventRepository } from '../persistence/EventRepository.js';
import { CrashRecovery, type RecoveryScanResult } from './CrashRecovery.js';
import { EventLogger } from './EventLogger.js';

export interface RecoveryManagerConfig {
  /** Whether to run recovery on startup (default: true) */
  enabled: boolean;
  /** Maximum number of sagas to recover in parallel (default: 5) */
  maxConcurrent: number;
  /** Whether to log recovery events (default: true) */
  logEvents: boolean;
}

const DEFAULT_CONFIG: RecoveryManagerConfig = {
  enabled: true,
  maxConcurrent: 5,
  logEvents: true,
};

export class RecoveryManager {
  private readonly config: RecoveryManagerConfig;
  private readonly crashRecovery: CrashRecovery;
  private readonly eventLogger: EventLogger | null;

  constructor(pool: Pool, config: Partial<RecoveryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const sagaRepo = new SagaRepository(pool);
    const workflowRepo = new WorkflowRepository(pool);

    if (this.config.logEvents) {
      const eventRepo = new EventRepository(pool);
      this.eventLogger = new EventLogger(eventRepo);
    } else {
      this.eventLogger = null;
    }

    this.crashRecovery = new CrashRecovery(
      sagaRepo,
      workflowRepo,
      this.eventLogger
    );
  }

  /**
   * Run recovery on startup.
   * Returns a summary of what was recovered.
   */
  async runRecovery(): Promise<RecoveryScanResult> {
    if (!this.config.enabled) {
      return {
        totalFound: 0,
        recovered: [],
        failed: [],
        skipped: 0,
      };
    }

    return this.crashRecovery.recoverAll();
  }

  /**
   * Format recovery results for logging.
   */
  static formatResults(result: RecoveryScanResult): string {
    const lines: string[] = [];
    lines.push(`Recovery scan complete:`);
    lines.push(`  Total unfinished: ${result.totalFound}`);
    lines.push(`  Recovered: ${result.recovered.length}`);
    lines.push(`  Failed: ${result.failed.length}`);
    lines.push(`  Skipped: ${result.skipped}`);

    if (result.recovered.length > 0) {
      lines.push(`  Recovered sagas:`);
      for (const r of result.recovered) {
        lines.push(`    - ${r.sagaId}: ${r.previousStatus} → ${r.finalStatus} (${r.action})`);
      }
    }

    if (result.failed.length > 0) {
      lines.push(`  Failed recoveries:`);
      for (const r of result.failed) {
        lines.push(`    - ${r.sagaId}: ${r.error ?? 'unknown error'}`);
      }
    }

    return lines.join('\n');
  }
}
