import { create } from 'zustand';
import { DriveInfo, DetectedEnvironment } from '@cleaner/shared';
import { normalizeError } from '../lib/errorUtils.js';

interface DiskStore {
  drives: DriveInfo[];
  environments: DetectedEnvironment[];
  selectedDrive: string;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  setSelectedDrive: (drive: string) => void;
  fetchSystemInfo: () => Promise<void>;
}

export const useDiskStore = create<DiskStore>((set) => ({
  drives: [],
  environments: [],
  selectedDrive: 'C:',
  loading: false,
  error: null,
  clearError: () => set({ error: null }),

  setSelectedDrive: (drive) => set({ selectedDrive: drive }),

  fetchSystemInfo: async () => {
    set({ loading: true, error: null });
    try {
      if (window.cleaner) {
        const [drives, environments] = await Promise.all([
          window.cleaner.getDrives(),
          window.cleaner.getEnvironments()
        ]);
        set({
          drives,
          environments,
          selectedDrive: drives.length > 0 ? drives[0].caption : 'C:',
          loading: false,
          error: null
        });
      } else {
        set({
          loading: false,
          error: 'System cleaner bridge is not available.'
        });
      }
    } catch (err) {
      set({
        loading: false,
        error: normalizeError(err)
      });
    }
  }
}));
