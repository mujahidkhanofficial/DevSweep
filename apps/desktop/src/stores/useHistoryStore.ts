import { create } from 'zustand';
import { CleanupTransaction } from '@cleaner/shared';
import { normalizeError } from '../lib/errorUtils.js';

interface HistoryStore {
  transactions: CleanupTransaction[];
  loading: boolean;
  error: string | null;
  clearError: () => void;
  loadHistory: () => Promise<void>;
  pruneHistory: () => Promise<{ success: boolean; prunedCount?: number; remainingCount?: number; error?: string }>;
  clearHistory: () => Promise<{ success: boolean; clearedCount?: number; error?: string }>;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  transactions: [],
  loading: false,
  error: null,
  clearError: () => set({ error: null }),

  loadHistory: async () => {
    set({ loading: true, error: null });
    try {
      if (window.cleaner) {
        const list = await window.cleaner.getHistory();
        set({ transactions: [...list].reverse(), loading: false, error: null });
      } else {
        set({ loading: false, error: 'Desktop bridge not available' });
      }
    } catch (err) {
      set({ loading: false, error: normalizeError(err) });
    }
  },

  pruneHistory: async () => {
    if (!window.cleaner) return { success: false, error: 'Desktop bridge not available' };
    try {
      const res = await window.cleaner.pruneHistory();
      await get().loadHistory();
      return res;
    } catch (err) {
      const msg = normalizeError(err);
      return { success: false, error: msg };
    }
  },

  clearHistory: async () => {
    if (!window.cleaner) return { success: false, error: 'Desktop bridge not available' };
    try {
      const res = await window.cleaner.clearHistory();
      await get().loadHistory();
      return res;
    } catch (err) {
      const msg = normalizeError(err);
      return { success: false, error: msg };
    }
  }
}));
