import { contextBridge, ipcRenderer } from 'electron';
import {
  StartScanRequest,
  ExecuteCleanupRequest,
  DriveInfo,
  DetectedEnvironment,
  ScanProgressEvent,
  CleanupTransaction,
  ScannedItem,
  HistoryRetentionConfig
} from '@cleaner/shared';

export const cleanerApi = {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Drive & Environment Discovery
  getDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke('disk:get-drives'),
  getEnvironments: (): Promise<DetectedEnvironment[]> => ipcRenderer.invoke('env:get-detected'),
  getRules: (): Promise<any[]> => ipcRenderer.invoke('rules:get-all'),

  // Scan lifecycle
  startScan: (payload?: StartScanRequest): Promise<{ scanSessionId: string; isCancelled: boolean; items: ScannedItem[] }> =>
    ipcRenderer.invoke('scan:start', payload || {}),
  pauseScan: (): Promise<boolean> => ipcRenderer.invoke('scan:pause'),
  resumeScan: (): Promise<boolean> => ipcRenderer.invoke('scan:resume'),
  cancelScan: (scanSessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('scan:cancel', { scanSessionId }),
  onScanProgress: (callback: (progress: ScanProgressEvent) => void) => {
    const listener = (_event: any, progress: ScanProgressEvent) => callback(progress);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },

  // Shell integration
  revealInExplorer: (pathStr: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:reveal', pathStr),
  browseFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('shell:browse-folder'),
  validatePath: (pathStr: string): Promise<{ valid: boolean; exists: boolean; isDirectory: boolean; message: string }> =>
    ipcRenderer.invoke('path:validate', pathStr),

  // Cleanup execution (Zero arbitrary paths! Rule ID + Session ID + Item IDs)
  executeCleanup: (payload: ExecuteCleanupRequest): Promise<CleanupTransaction> =>
    ipcRenderer.invoke('cleanup:execute', payload),
  pauseCleanup: (): Promise<boolean> => ipcRenderer.invoke('cleanup:pause'),
  resumeCleanup: (): Promise<boolean> => ipcRenderer.invoke('cleanup:resume'),
  cancelCleanup: (): Promise<boolean> => ipcRenderer.invoke('cleanup:cancel'),
  onCleanupProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('cleanup:progress', listener);
    return () => ipcRenderer.removeListener('cleanup:progress', listener);
  },

  // Protected paths
  getProtectedPaths: (): Promise<string[]> => ipcRenderer.invoke('protected-paths:get'),
  addProtectedPath: (pathStr: string): Promise<string[]> =>
    ipcRenderer.invoke('protected-paths:add', { path: pathStr }),
  removeProtectedPath: (pathStr: string): Promise<string[]> =>
    ipcRenderer.invoke('protected-paths:remove', { path: pathStr }),

  // History & Retention
  getHistory: (): Promise<CleanupTransaction[]> => ipcRenderer.invoke('history:get'),
  exportHistoryFile: (
    format: 'json' | 'csv',
    content: string
  ): Promise<{ success?: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('history:export-file', { format, content }),
  getHistoryRetentionConfig: (): Promise<HistoryRetentionConfig> =>
    ipcRenderer.invoke('history:get-retention-config'),
  saveHistoryRetentionConfig: (
    config: HistoryRetentionConfig
  ): Promise<{ success: boolean; error?: string; config?: HistoryRetentionConfig }> =>
    ipcRenderer.invoke('history:save-retention-config', config),
  pruneHistory: (): Promise<{ success: boolean; prunedCount?: number; remainingCount?: number; error?: string }> =>
    ipcRenderer.invoke('history:prune'),
  clearHistory: (): Promise<{ success: boolean; clearedCount?: number; error?: string }> =>
    ipcRenderer.invoke('history:clear')
};

contextBridge.exposeInMainWorld('devsweep', cleanerApi);
contextBridge.exposeInMainWorld('cleaner', cleanerApi);
