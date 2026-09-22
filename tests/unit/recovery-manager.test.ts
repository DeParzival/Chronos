// ============================================================
// Chronos — Unit Tests: Recovery Manager
// ============================================================

import { describe, it, expect } from 'vitest';
import { RecoveryManager } from '../../src/recovery/RecoveryManager.js';
import { type RecoveryScanResult } from '../../src/recovery/CrashRecovery.js';
import { SagaStatus } from '../../src/types/index.js';

describe('RecoveryManager', () => {
  describe('formatResults', () => {
    it('should format empty results', () => {
      const result: RecoveryScanResult = {
        totalFound: 0,
        recovered: [],
        failed: [],
        skipped: 0,
      };

      const output = RecoveryManager.formatResults(result);

      expect(output).toContain('Total unfinished: 0');
      expect(output).toContain('Recovered: 0');
      expect(output).toContain('Failed: 0');
    });

    it('should format results with recovered sagas', () => {
      const result: RecoveryScanResult = {
        totalFound: 2,
        recovered: [
          {
            sagaId: 'saga-1',
            previousStatus: SagaStatus.EXECUTING,
            finalStatus: SagaStatus.COMPLETED,
            action: 'resumed_execution',
          },
          {
            sagaId: 'saga-2',
            previousStatus: SagaStatus.COMPENSATING,
            finalStatus: SagaStatus.ROLLED_BACK,
            action: 'resumed_compensation',
          },
        ],
        failed: [],
        skipped: 0,
      };

      const output = RecoveryManager.formatResults(result);

      expect(output).toContain('Total unfinished: 2');
      expect(output).toContain('Recovered: 2');
      expect(output).toContain('saga-1');
      expect(output).toContain('EXECUTING → COMPLETED');
      expect(output).toContain('saga-2');
      expect(output).toContain('resumed_compensation');
    });

    it('should format results with failed recoveries', () => {
      const result: RecoveryScanResult = {
        totalFound: 1,
        recovered: [],
        failed: [
          {
            sagaId: 'saga-3',
            previousStatus: SagaStatus.EXECUTING,
            finalStatus: SagaStatus.EXECUTING,
            action: 'skipped',
            error: 'Workflow not found',
          },
        ],
        skipped: 0,
      };

      const output = RecoveryManager.formatResults(result);

      expect(output).toContain('Failed: 1');
      expect(output).toContain('saga-3');
      expect(output).toContain('Workflow not found');
    });

    it('should format results with skipped sagas', () => {
      const result: RecoveryScanResult = {
        totalFound: 3,
        recovered: [],
        failed: [],
        skipped: 3,
      };

      const output = RecoveryManager.formatResults(result);

      expect(output).toContain('Skipped: 3');
    });
  });
});
