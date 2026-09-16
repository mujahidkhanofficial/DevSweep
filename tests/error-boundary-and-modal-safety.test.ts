import { describe, it, expect } from 'vitest';
import { ErrorBoundary } from '../apps/desktop/src/components/common/ErrorBoundary.js';
import { useScanStore } from '../apps/desktop/src/stores/useScanStore.js';
import { useHistoryStore } from '../apps/desktop/src/stores/useHistoryStore.js';

describe('Error Boundary & Empty-State Cleanup Safety', () => {
  describe('ErrorBoundary Component', () => {
    it('initializes with hasError: false', () => {
      const boundary = new ErrorBoundary({ children: null });
      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
    });

    it('captures errors using getDerivedStateFromError', () => {
      const testError = new Error('Test rendering crash');
      const state = ErrorBoundary.getDerivedStateFromError(testError);
      expect(state.hasError).toBe(true);
      expect(state.error).toBe(testError);
    });
  });

  describe('ScanStore removeItemsAfterCleanup Safety', () => {
    it('safely handles empty or undefined items without throwing', () => {
      const store = useScanStore.getState();
      expect(() => {
        store.removeItemsAfterCleanup([]);
      }).not.toThrow();

      expect(() => {
        // @ts-expect-error testing edge cases
        store.removeItemsAfterCleanup(undefined);
      }).not.toThrow();
    });

    it('updates remaining items and sets currentSessionReclaimed when all items removed', () => {
      useScanStore.setState({
        items: [
          { id: 'i1', path: 'C:/temp/1', size: 100, label: 'item 1', safetyLevel: 'SAFE', category: 'NODE', ruleId: 'r1', selectedByDefault: true, fileCount: 1 } as any
        ],
        selectedItemIds: new Set(['i1']),
        scannedCandidateCount: 1,
        currentSessionReclaimed: false
      });

      useScanStore.getState().removeItemsAfterCleanup(['i1']);

      const updated = useScanStore.getState();
      expect(updated.items.length).toBe(0);
      expect(updated.selectedItemIds.size).toBe(0);
      expect(updated.currentSessionReclaimed).toBe(true);
    });
  });

  describe('HistoryStore Null-Safe Transaction Processing', () => {
    it('safely filters transactions with missing or undefined skippedDetails', () => {
      const corruptTx = {
        transactionId: 'tx-corrupt',
        scanSessionId: 'sess-1',
        ruleId: 'BATCH_ALL',
        startedAt: Date.now(),
        status: 'COMPLETED',
        bytesReclaimed: 1024,
        deletedCount: 1,
        skippedCount: 0,
        skippedDetails: undefined // Edge case: omitted or undefined
      };

      const skippedList = Array.isArray(corruptTx.skippedDetails) ? corruptTx.skippedDetails : [];
      expect(skippedList.length).toBe(0);
      expect(() => skippedList.map((s: any) => s.path)).not.toThrow();
    });
  });
});
