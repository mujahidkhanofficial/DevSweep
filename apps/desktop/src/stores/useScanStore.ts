import { create } from 'zustand';
import { ScannedItem, ScanProgressEvent, ToolchainId } from '@cleaner/shared';
import { normalizeError } from '../lib/errorUtils.js';

export type ScanStatus = 'IDLE' | 'SCANNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

interface ScanStore {
  scanStatus: ScanStatus;
  scanSessionId: string | null;
  scannedCandidateCount: number | null;
  currentSessionReclaimed: boolean;
  error: string | null;
  clearError: () => void;
  isScanning: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  progress: ScanProgressEvent | null;
  items: ScannedItem[];
  selectedItemIds: Set<string>;
  toolchainFilter: ToolchainId | null;
  setToolchainFilter: (id: ToolchainId | null) => void;
  startScan: () => Promise<void>;
  pauseScan: () => Promise<void>;
  resumeScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  toggleItemSelection: (id: string) => void;
  selectAll: (selected: boolean) => void;
  selectCategory: (category: string, selected: boolean) => void;
  selectItems: (ids: string[], selected: boolean) => void;
  removeItemsAfterCleanup: (deletedIds: string[]) => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  scanStatus: 'IDLE',
  scanSessionId: null,
  scannedCandidateCount: null,
  currentSessionReclaimed: false,
  error: null,
  clearError: () => set({ error: null }),
  isScanning: false,
  isPaused: false,
  isCancelled: false,
  progress: null,
  items: [],
  selectedItemIds: new Set<string>(),
  toolchainFilter: null,

  setToolchainFilter: (id) => set({ toolchainFilter: id }),

  startScan: async () => {
    set({
      scanStatus: 'SCANNING',
      isScanning: true,
      isPaused: false,
      isCancelled: false,
      error: null,
      currentSessionReclaimed: false,
      scannedCandidateCount: null,
      progress: null,
      items: [],
      selectedItemIds: new Set(),
      toolchainFilter: null
    });

    let cleanupListener: (() => void) | undefined;
    if (window.cleaner) {
      cleanupListener = window.cleaner.onScanProgress((prog) => {
        set({
          progress: prog,
          isPaused: prog.status === 'PAUSED'
        });
      });

      try {
        const result = await window.cleaner.startScan();
        const initialSelected = new Set(
          result.items.filter((it) => it.selectedByDefault).map((it) => it.id)
        );
        const finalStatus = result.isCancelled ? 'CANCELLED' : 'COMPLETED';
        set({
          scanStatus: finalStatus,
          scanSessionId: result.scanSessionId,
          scannedCandidateCount: result.items.length,
          isScanning: false,
          isPaused: false,
          isCancelled: result.isCancelled,
          items: result.items,
          selectedItemIds: initialSelected,
          error: null
        });
      } catch (err) {
        set({
          scanStatus: 'FAILED',
          isScanning: false,
          isPaused: false,
          error: normalizeError(err)
        });
      } finally {
        cleanupListener?.();
      }
    } else {
      set({
        scanStatus: 'FAILED',
        isScanning: false,
        error: 'System cleaner bridge is not available.'
      });
    }
  },

  pauseScan: async () => {
    if (window.cleaner) {
      await window.cleaner.pauseScan();
      set({ isPaused: true });
    }
  },

  resumeScan: async () => {
    if (window.cleaner) {
      await window.cleaner.resumeScan();
      set({ isPaused: false });
    }
  },

  cancelScan: async () => {
    const { scanSessionId } = get();
    if (scanSessionId && window.cleaner) {
      await window.cleaner.cancelScan(scanSessionId);
    }
    set({ scanStatus: 'CANCELLED', isScanning: false, isPaused: false, isCancelled: true });
  },

  toggleItemSelection: (id) => {
    const { selectedItemIds } = get();
    const updated = new Set(selectedItemIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    set({ selectedItemIds: updated });
  },

  selectAll: (selected) => {
    const { items } = get();
    if (selected) {
      const selectable = items.filter((i) => i.safetyLevel !== 'PROTECTED').map((i) => i.id);
      set({ selectedItemIds: new Set(selectable) });
    } else {
      set({ selectedItemIds: new Set() });
    }
  },

  selectCategory: (category, selected) => {
    const { items, selectedItemIds } = get();
    const updated = new Set(selectedItemIds);
    for (const item of items) {
      if (item.category === category && item.safetyLevel !== 'PROTECTED') {
        if (selected) {
          updated.add(item.id);
        } else {
          updated.delete(item.id);
        }
      }
    }
    set({ selectedItemIds: updated });
  },

  selectItems: (ids, selected) => {
    const { selectedItemIds } = get();
    const updated = new Set(selectedItemIds);
    for (const id of ids) {
      if (selected) {
        updated.add(id);
      } else {
        updated.delete(id);
      }
    }
    set({ selectedItemIds: updated });
  },

  removeItemsAfterCleanup: (deletedIds) => {
    const { items = [], selectedItemIds, scannedCandidateCount } = get();
    const deletedSet = new Set(deletedIds || []);
    const remainingItems = (items || []).filter((i) => i && !deletedSet.has(i.id));
    const selectedArray = selectedItemIds instanceof Set ? Array.from(selectedItemIds) : [];
    const remainingSelected = new Set(selectedArray.filter((id) => !deletedSet.has(id)));
    const isNowAllReclaimed = remainingItems.length === 0 && (scannedCandidateCount ?? 0) > 0;
    set({
      items: remainingItems,
      selectedItemIds: remainingSelected,
      currentSessionReclaimed: isNowAllReclaimed
    });
  }
}));
