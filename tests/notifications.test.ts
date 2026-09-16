import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  shouldSendNotification,
  formatScanNotification,
  formatCleanupNotification,
  CleanupTransaction
} from '@cleaner/shared';

describe('Notifications System — Priority 4.1', () => {
  describe('formatBytes utility', () => {
    it('formats 0 bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats KB, MB, GB, TB with default precision', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
      expect(formatBytes(1024 * 1024 * 1024 * 2.345)).toBe('2.3 GB');
    });
  });

  describe('Foreground / Background State Suppression', () => {
    it('suppresses notifications when the application window is focused in foreground', () => {
      expect(shouldSendNotification(true)).toBe(false);
    });

    it('allows notifications when the application window is in background / unfocused / minimized', () => {
      expect(shouldSendNotification(false)).toBe(true);
    });
  });

  describe('Scan Notifications', () => {
    it('formats notification for completed scan with candidates', () => {
      const payload = formatScanNotification(12, 1024 * 1024 * 150, false);
      expect(payload.title).toBe('DevSweep — Scan Complete');
      expect(payload.body).toContain('Discovered 12 cleanup candidates (150 MB)');
      expect(payload.urgency).toBe('normal');
    });

    it('formats notification for singular candidate correctly', () => {
      const payload = formatScanNotification(1, 1024 * 1024 * 20, false);
      expect(payload.body).toContain('Discovered 1 cleanup candidate (20 MB)');
    });

    it('formats notification when 0 candidates are found', () => {
      const payload = formatScanNotification(0, 0, false);
      expect(payload.title).toBe('DevSweep — Scan Complete');
      expect(payload.body).toBe('No reclaimable developer caches found. Your system is clean.');
      expect(payload.urgency).toBe('normal');
    });

    it('formats notification for cancelled scan', () => {
      const payload = formatScanNotification(5, 1024 * 1024, true);
      expect(payload.title).toBe('DevSweep — Scan Cancelled');
      expect(payload.body).toBe('The developer disk scan was stopped before completion.');
      expect(payload.urgency).toBe('low');
    });
  });

  describe('Cleanup Notifications', () => {
    const baseTx: CleanupTransaction = {
      transactionId: 'tx-test-1',
      scanSessionId: 'session-123',
      ruleId: 'npm-cache',
      status: 'COMPLETED',
      dryRun: false,
      startedAt: 1000,
      completedAt: 2000,
      totalRequested: 5,
      validatedCount: 5,
      deletedCount: 5,
      skippedCount: 0,
      failedCount: 0,
      timedOutCount: 0,
      cancelledCount: 0,
      bytesReclaimed: 1024 * 1024 * 500,
      skippedDetails: []
    };

    it('formats notification for 100% successful cleanup', () => {
      const payload = formatCleanupNotification(baseTx, false);
      expect(payload.title).toBe('DevSweep — Cleanup Complete');
      expect(payload.body).toContain('Successfully reclaimed 500 MB across 5 items.');
      expect(payload.urgency).toBe('normal');
    });

    it('formats notification for dry-run simulation', () => {
      const payload = formatCleanupNotification(baseTx, true);
      expect(payload.title).toBe('DevSweep — Simulation Complete');
      expect(payload.body).toContain('Dry-run completed: 5 items (500 MB) eligible for deletion.');
      expect(payload.urgency).toBe('normal');
    });

    it('formats notification for partial cleanup failure with locked/failed items', () => {
      const partialTx: CleanupTransaction = {
        ...baseTx,
        status: 'PARTIAL',
        deletedCount: 3,
        failedCount: 2,
        bytesReclaimed: 1024 * 1024 * 300
      };
      const payload = formatCleanupNotification(partialTx, false);
      expect(payload.title).toBe('DevSweep — Cleanup Completed with Warnings');
      expect(payload.body).toContain('Reclaimed 300 MB. 2 items could not be removed.');
      expect(payload.urgency).toBe('normal');
    });

    it('formats notification for fatal cleanup failure', () => {
      const failedTx: CleanupTransaction = {
        ...baseTx,
        status: 'FAILED',
        deletedCount: 0,
        failedCount: 5,
        bytesReclaimed: 0
      };
      const payload = formatCleanupNotification(failedTx, false);
      expect(payload.title).toBe('DevSweep — Cleanup Failed');
      expect(payload.body).toBe('Cleanup could not be completed due to an error.');
      expect(payload.urgency).toBe('critical');
    });

    it('formats notification for cancelled cleanup', () => {
      const cancelledTx: CleanupTransaction = {
        ...baseTx,
        status: 'CANCELLED',
        deletedCount: 2,
        bytesReclaimed: 1024 * 1024 * 200
      };
      const payload = formatCleanupNotification(cancelledTx, false);
      expect(payload.title).toBe('DevSweep — Cleanup Cancelled');
      expect(payload.body).toContain('Operation stopped. 2 items removed prior to cancellation.');
    });
  });
});
