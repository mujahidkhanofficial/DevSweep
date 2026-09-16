export interface DriveInfo {
  caption: string;         // e.g. "C:"
  volumeName: string;      // e.g. "Windows"
  totalBytes: number;      // 64-bit byte count
  freeBytes: number;       // 64-bit byte count
  usedBytes: number;
  percentUsed: number;     // 0 - 100
}

export interface DetectedEnvironment {
  id: string;
  name: string;
  detected: boolean;
  version?: string;
  installPath?: string;
}

export interface ScanProgressEvent {
  scanSessionId: string;
  status: 'SCANNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  currentCategory?: string;
  currentRule?: string;
  currentRuleIndex: number;
  totalRules: number;
  currentPath?: string;
  scannedFiles: number;
  scannedBytes: number;
  estimatedReclaimableBytes: number;
  filesPerSecond: number;
  bytesPerSecond: number;
  elapsedTimeMs: number;
  estimatedRemainingTimeMs: number;
}

export type NormalizedFsErrorCategory =
  | 'FILE_IN_USE'
  | 'ACCESS_DENIED'
  | 'READ_ONLY'
  | 'NOT_FOUND'
  | 'PATH_TOO_LONG'
  | 'INVALID_PATH'
  | 'REPARSE_POINT'
  | 'UNKNOWN';

export type HeartbeatStatus = 'ACTIVE' | 'WORKING' | 'SLOW' | 'STALLED';

export interface CleanupProgressEvent {
  transactionId: string;
  scanSessionId: string;
  status: 'PENDING' | 'VALIDATING' | 'RUNNING' | 'PAUSED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

  // Session level (strictly terminal accounting)
  totalItems: number;
  processedItems: number;
  deletedItems: number;
  skippedItems: number;
  failedItems: number;
  timedOutItems: number;
  cancelledItems: number;
  totalBytesToReclaim: number;
  bytesReclaimed: number;

  // Active Item level (hierarchical)
  activeItemId?: string;
  activeItemName?: string;
  activeItemPath?: string;
  activeItemState?: 'PENDING' | 'VALIDATING' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
  currentOperation?: string;
  discoveryState?: 'DISCOVERING' | 'PROCESSING' | 'FINALIZING';
  filesDiscovered?: number;
  filesProcessed?: number;
  filesDeleted?: number;
  filesSkipped?: number;
  itemBytesReclaimed?: number;
  itemTotalBytes?: number;

  // Heartbeat & Activity
  heartbeatStatus?: HeartbeatStatus;
  heartbeatMessage?: string;

  // Telemetry & Velocity
  bytesPerSecond: number;
  elapsedTimeMs: number;
  estimatedRemainingTimeMs: number;

  // Compatibility aliases
  currentItemIndex: number;
  currentItemName: string;
  currentPath: string;
  deletedCount: number;
  skippedCount: number;
  itemsLeft: number;
}
