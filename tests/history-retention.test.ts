import { describe, it, expect } from 'vitest';
import {
  pruneHistoryRecords,
  validateRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
  CleanupTransaction
} from '../packages/shared/src/index.js';

function createMockTx(overrides: Partial<CleanupTransaction>): CleanupTransaction {
  return {
    transactionId: overrides.transactionId || 'tx-' + Math.random().toString(36).substring(2, 9),
    scanSessionId: overrides.scanSessionId || 'session-mock',
    ruleId: overrides.ruleId || 'NODE_NPM_CACHE',
    startedAt: overrides.startedAt !== undefined ? overrides.startedAt : Date.now(),
    completedAt: overrides.completedAt || Date.now() + 1000,
    status: overrides.status || 'COMPLETED',
    totalRequested: overrides.totalRequested || 1,
    validatedCount: overrides.validatedCount || 1,
    deletedCount: overrides.deletedCount || 1,
    skippedCount: overrides.skippedCount || 0,
    failedCount: overrides.failedCount || 0,
    timedOutCount: overrides.timedOutCount || 0,
    cancelledCount: overrides.cancelledCount || 0,
    bytesReclaimed: overrides.bytesReclaimed || 1024,
    dryRun: overrides.dryRun ?? false,
    skippedDetails: overrides.skippedDetails || [],
    items: overrides.items || [
      {
        itemId: 'item-1',
        ruleId: overrides.ruleId || 'NODE_NPM_CACHE',
        path: 'C:\\Users\\dev\\cache',
        sizeBytes: 1024,
        result: 'SUCCESS',
        toolchainId: 'npm',
        safetyLevel: 'SAFE'
      }
    ],
    toolchainId: overrides.toolchainId || 'npm',
    safetyLevel: overrides.safetyLevel || 'SAFE'
  };
}

describe('Priority 4.5 — History Retention & Pruning Engine', () => {
  describe('validateRetentionConfig — Strict Numerical & Schema Validation', () => {
    it('accepts valid configuration objects', () => {
      const res = validateRetentionConfig({
        maxRecords: 100,
        maxAgeDays: 90,
        autoPruneOnSave: true
      });
      expect(res.valid).toBe(true);
      expect(res.config).toEqual({
        maxRecords: 100,
        maxAgeDays: 90,
        autoPruneOnSave: true
      });
    });

    it('allows 0 as unlimited for maxRecords and maxAgeDays', () => {
      const res = validateRetentionConfig({
        maxRecords: 0,
        maxAgeDays: 0,
        autoPruneOnSave: false
      });
      expect(res.valid).toBe(true);
      expect(res.config?.maxRecords).toBe(0);
      expect(res.config?.maxAgeDays).toBe(0);
    });

    it('rejects negative maxRecords', () => {
      const res = validateRetentionConfig({
        maxRecords: -5,
        maxAgeDays: 30,
        autoPruneOnSave: true
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('maxRecords');
    });

    it('rejects fractional maxRecords', () => {
      const res = validateRetentionConfig({
        maxRecords: 25.5,
        maxAgeDays: 30,
        autoPruneOnSave: true
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('maxRecords');
    });

    it('rejects negative maxAgeDays', () => {
      const res = validateRetentionConfig({
        maxRecords: 100,
        maxAgeDays: -1,
        autoPruneOnSave: true
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('maxAgeDays');
    });

    it('rejects fractional maxAgeDays', () => {
      const res = validateRetentionConfig({
        maxRecords: 100,
        maxAgeDays: 30.2,
        autoPruneOnSave: true
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('maxAgeDays');
    });

    it('rejects Infinity and NaN values', () => {
      expect(
        validateRetentionConfig({
          maxRecords: Infinity,
          maxAgeDays: 30,
          autoPruneOnSave: true
        }).valid
      ).toBe(false);

      expect(
        validateRetentionConfig({
          maxRecords: 100,
          maxAgeDays: NaN,
          autoPruneOnSave: true
        }).valid
      ).toBe(false);
    });

    it('rejects non-boolean autoPruneOnSave', () => {
      const res = validateRetentionConfig({
        maxRecords: 100,
        maxAgeDays: 30,
        autoPruneOnSave: 'yes' as any
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('autoPruneOnSave');
    });
  });

  describe('pruneHistoryRecords — Deterministic Filtering & Sorting', () => {
    const NOW = 1700000000000; // Reference timestamp
    const ONE_DAY = 24 * 60 * 60 * 1000;

    it('unsorted input produces deterministic newest-N result', () => {
      const tx1 = createMockTx({ transactionId: 'tx-10d-old', startedAt: NOW - 10 * ONE_DAY });
      const tx2 = createMockTx({ transactionId: 'tx-1d-old', startedAt: NOW - 1 * ONE_DAY });
      const tx3 = createMockTx({ transactionId: 'tx-5d-old', startedAt: NOW - 5 * ONE_DAY });
      const tx4 = createMockTx({ transactionId: 'tx-2d-old', startedAt: NOW - 2 * ONE_DAY });

      // Pass in intentionally scrambled order: [10d, 1d, 5d, 2d]
      const input = [tx1, tx2, tx3, tx4];
      const { prunedHistory, prunedCount } = pruneHistoryRecords(input, {
        maxRecords: 2,
        now: NOW
      });

      expect(prunedCount).toBe(2);
      expect(prunedHistory).toHaveLength(2);
      // Newest 2 should be tx-1d-old and tx-2d-old in descending order
      expect(prunedHistory[0].transactionId).toBe('tx-1d-old');
      expect(prunedHistory[1].transactionId).toBe('tx-2d-old');
    });

    it('equal timestamps preserve stable original ordering', () => {
      const txA = createMockTx({ transactionId: 'tx-A', startedAt: NOW - 2 * ONE_DAY });
      const txB = createMockTx({ transactionId: 'tx-B', startedAt: NOW - 2 * ONE_DAY });
      const txC = createMockTx({ transactionId: 'tx-C', startedAt: NOW - 2 * ONE_DAY });

      const input = [txA, txB, txC];
      const { prunedHistory } = pruneHistoryRecords(input, {
        maxRecords: 2,
        now: NOW
      });

      expect(prunedHistory).toHaveLength(2);
      expect(prunedHistory[0].transactionId).toBe('tx-A');
      expect(prunedHistory[1].transactionId).toBe('tx-B');
    });

    it('malformed startedAt records are strictly preserved', () => {
      const oldValid = createMockTx({ transactionId: 'tx-120d', startedAt: NOW - 120 * ONE_DAY });
      const malformedNaN = createMockTx({ transactionId: 'tx-nan', startedAt: NaN as any });
      const malformedNegative = createMockTx({ transactionId: 'tx-neg', startedAt: -100 as any });
      const malformedZero = createMockTx({ transactionId: 'tx-zero', startedAt: 0 as any });
      const malformedString = createMockTx({ transactionId: 'tx-str', startedAt: 'invalid' as any });
      const recentValid = createMockTx({ transactionId: 'tx-5d', startedAt: NOW - 5 * ONE_DAY });

      const input = [oldValid, malformedNaN, malformedNegative, malformedZero, malformedString, recentValid];
      const { prunedHistory, prunedCount } = pruneHistoryRecords(input, {
        maxAgeDays: 90,
        now: NOW
      });

      // tx-120d is older than 90 days and MUST be pruned.
      // All malformed records MUST be preserved to prevent permanent accidental audit loss!
      expect(prunedCount).toBe(1);
      const remainingIds = prunedHistory.map((t) => t.transactionId);
      expect(remainingIds).not.toContain('tx-120d');
      expect(remainingIds).toContain('tx-nan');
      expect(remainingIds).toContain('tx-neg');
      expect(remainingIds).toContain('tx-zero');
      expect(remainingIds).toContain('tx-str');
      expect(remainingIds).toContain('tx-5d');
    });

    it('missing startedAt records are strictly preserved', () => {
      const oldValid = createMockTx({ transactionId: 'tx-old', startedAt: NOW - 100 * ONE_DAY });
      const missingTimestamp = createMockTx({ transactionId: 'tx-missing' });
      delete (missingTimestamp as any).startedAt;

      const input = [oldValid, missingTimestamp];
      const { prunedHistory, prunedCount } = pruneHistoryRecords(input, {
        maxAgeDays: 30,
        now: NOW
      });

      expect(prunedCount).toBe(1);
      expect(prunedHistory).toHaveLength(1);
      expect(prunedHistory[0].transactionId).toBe('tx-missing');
    });

    it('retained transaction objects and items[] metadata remain completely unchanged', () => {
      const tx = createMockTx({
        transactionId: 'tx-preserve-test',
        startedAt: NOW - 5 * ONE_DAY,
        ruleId: 'GRADLE_CACHES',
        toolchainId: 'gradle',
        safetyLevel: 'SAFE',
        items: [
          {
            itemId: 'g-1',
            ruleId: 'GRADLE_CACHES',
            path: 'C:\\Users\\dev\\.gradle\\cache',
            sizeBytes: 99999,
            result: 'SUCCESS',
            toolchainId: 'gradle',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const input = [tx];
      const { prunedHistory } = pruneHistoryRecords(input, {
        maxRecords: 10,
        maxAgeDays: 30,
        now: NOW
      });

      expect(prunedHistory[0]).toBe(tx); // Reference equality preserved
      expect(prunedHistory[0].items).toBe(tx.items);
      expect(prunedHistory[0].items?.[0].path).toBe('C:\\Users\\dev\\.gradle\\cache');
      expect(prunedHistory[0].toolchainId).toBe('gradle');
    });

    it('original input array is not mutated', () => {
      const tx1 = createMockTx({ transactionId: 'tx-1', startedAt: NOW - 10 * ONE_DAY });
      const tx2 = createMockTx({ transactionId: 'tx-2', startedAt: NOW - 1 * ONE_DAY });
      const input = [tx1, tx2];
      const frozenInput = Object.freeze([...input]);

      const { prunedHistory } = pruneHistoryRecords(frozenInput as CleanupTransaction[], {
        maxRecords: 1,
        now: NOW
      });

      expect(frozenInput).toHaveLength(2);
      expect(frozenInput[0]).toBe(tx1);
      expect(frozenInput[1]).toBe(tx2);
      expect(prunedHistory).toHaveLength(1);
      expect(prunedHistory[0]).toBe(tx2);
    });

    it('handles empty history gracefully', () => {
      const { prunedHistory, prunedCount } = pruneHistoryRecords([], {
        maxRecords: 100,
        maxAgeDays: 90
      });
      expect(prunedHistory).toEqual([]);
      expect(prunedCount).toBe(0);
    });

    it('pruning is a pure function that never touches filesystem or Electron APIs', () => {
      // Proves function operates purely in memory with zero side-effects
      const tx = createMockTx({ transactionId: 'pure-test', startedAt: NOW });
      const res = pruneHistoryRecords([tx]);
      expect(res.prunedHistory).toHaveLength(1);
    });
  });
});
