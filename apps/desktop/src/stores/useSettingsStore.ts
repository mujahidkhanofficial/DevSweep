import { create } from 'zustand';
import { HistoryRetentionConfig, DEFAULT_RETENTION_CONFIG } from '@cleaner/shared';

interface SettingsStore {
  theme: 'dark' | 'light';
  protectedPaths: string[];
  lowSpaceThresholdGB: number;
  historyRetention: HistoryRetentionConfig;
  toggleTheme: () => void;
  loadProtectedPaths: () => Promise<void>;
  addProtectedPath: (path: string) => Promise<void>;
  removeProtectedPath: (path: string) => Promise<void>;
  setLowSpaceThreshold: (gb: number) => void;
  loadHistoryRetention: () => Promise<void>;
  saveHistoryRetention: (config: HistoryRetentionConfig) => Promise<{ success: boolean; error?: string }>;
  pruneHistoryNow: () => Promise<{ success: boolean; prunedCount?: number; remainingCount?: number; error?: string }>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: 'dark',
  protectedPaths: [],
  lowSpaceThresholdGB: 20,
  historyRetention: DEFAULT_RETENTION_CONFIG,

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: newTheme });
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  },

  loadProtectedPaths: async () => {
    if (window.cleaner) {
      const paths = await window.cleaner.getProtectedPaths();
      set({ protectedPaths: paths });
    }
  },

  addProtectedPath: async (p) => {
    if (window.cleaner && p.trim()) {
      const updated = await window.cleaner.addProtectedPath(p.trim());
      set({ protectedPaths: updated });
    }
  },

  removeProtectedPath: async (p) => {
    if (window.cleaner) {
      const updated = await window.cleaner.removeProtectedPath(p);
      set({ protectedPaths: updated });
    }
  },

  setLowSpaceThreshold: (gb) => set({ lowSpaceThresholdGB: gb }),

  loadHistoryRetention: async () => {
    if (window.cleaner) {
      const cfg = await window.cleaner.getHistoryRetentionConfig();
      if (cfg) {
        set({ historyRetention: cfg });
      }
    }
  },

  saveHistoryRetention: async (cfg: HistoryRetentionConfig) => {
    if (!window.cleaner) return { success: false, error: 'Desktop bridge not available' };
    const res = await window.cleaner.saveHistoryRetentionConfig(cfg);
    if (res.success && res.config) {
      set({ historyRetention: res.config });
    }
    return res;
  },

  pruneHistoryNow: async () => {
    if (!window.cleaner) return { success: false, error: 'Desktop bridge not available' };
    return await window.cleaner.pruneHistory();
  }
}));
