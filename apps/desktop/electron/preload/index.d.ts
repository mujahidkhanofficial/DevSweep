import { StartScanRequest, ExecuteCleanupRequest, DriveInfo, DetectedEnvironment, ScanProgressEvent, CleanupTransaction, ScannedItem } from '@cleaner/shared';
export declare const cleanerApi: {
    minimize: () => Promise<any>;
    maximize: () => Promise<any>;
    close: () => Promise<any>;
    getDrives: () => Promise<DriveInfo[]>;
    getEnvironments: () => Promise<DetectedEnvironment[]>;
    getRules: () => Promise<any[]>;
    startScan: (payload?: StartScanRequest) => Promise<{
        scanSessionId: string;
        isCancelled: boolean;
        items: ScannedItem[];
    }>;
    cancelScan: (scanSessionId: string) => Promise<boolean>;
    onScanProgress: (callback: (progress: ScanProgressEvent) => void) => () => Electron.IpcRenderer;
    executeCleanup: (payload: ExecuteCleanupRequest) => Promise<CleanupTransaction>;
    getProtectedPaths: () => Promise<string[]>;
    addProtectedPath: (pathStr: string) => Promise<string[]>;
    removeProtectedPath: (pathStr: string) => Promise<string[]>;
    getHistory: () => Promise<CleanupTransaction[]>;
};
