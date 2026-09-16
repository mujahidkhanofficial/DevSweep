import { CleanupTransaction } from './rules.types.js';

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export interface NativeNotificationPayload {
  title: string;
  body: string;
  urgency?: 'normal' | 'critical' | 'low';
  silent?: boolean;
}

/**
 * Evaluates whether a native OS completion notification should be presented,
 * respecting the application's foreground/background focus state.
 */
export function shouldSendNotification(isWindowFocused: boolean): boolean {
  return !isWindowFocused;
}

/**
 * Formats a native notification payload for scan completion or cancellation.
 */
export function formatScanNotification(
  itemCount: number,
  totalBytes: number,
  isCancelled: boolean
): NativeNotificationPayload {
  if (isCancelled) {
    return {
      title: 'DevSweep — Scan Cancelled',
      body: 'The developer disk scan was stopped before completion.',
      urgency: 'low'
    };
  }

  if (itemCount === 0) {
    return {
      title: 'DevSweep — Scan Complete',
      body: 'No reclaimable developer caches found. Your system is clean.',
      urgency: 'normal'
    };
  }

  return {
    title: 'DevSweep — Scan Complete',
    body: `Discovered ${itemCount} cleanup candidate${itemCount === 1 ? '' : 's'} (${formatBytes(totalBytes)}) ready for review.`,
    urgency: 'normal'
  };
}

/**
 * Formats a native notification payload for cleanup completion, dry-run simulation, or errors.
 */
export function formatCleanupNotification(
  tx: CleanupTransaction,
  dryRun: boolean
): NativeNotificationPayload {
  if (dryRun) {
    return {
      title: 'DevSweep — Simulation Complete',
      body: `Dry-run completed: ${tx.deletedCount} item${tx.deletedCount === 1 ? '' : 's'} (${formatBytes(tx.bytesReclaimed)}) eligible for deletion.`,
      urgency: 'normal'
    };
  }

  const errorCount = tx.failedCount + tx.skippedCount;

  if (tx.status === 'FAILED') {
    return {
      title: 'DevSweep — Cleanup Failed',
      body: 'Cleanup could not be completed due to an error.',
      urgency: 'critical'
    };
  }

  if (tx.status === 'CANCELLED') {
    return {
      title: 'DevSweep — Cleanup Cancelled',
      body: `Operation stopped. ${tx.deletedCount} item${tx.deletedCount === 1 ? '' : 's'} removed prior to cancellation.`,
      urgency: 'normal'
    };
  }

  if (tx.status === 'COMPLETED' && errorCount === 0) {
    return {
      title: 'DevSweep — Cleanup Complete',
      body: `Successfully reclaimed ${formatBytes(tx.bytesReclaimed)} across ${tx.deletedCount} item${tx.deletedCount === 1 ? '' : 's'}.`,
      urgency: 'normal'
    };
  }

  if (errorCount > 0 || tx.status === 'PARTIAL') {
    return {
      title: 'DevSweep — Cleanup Completed with Warnings',
      body: `Reclaimed ${formatBytes(tx.bytesReclaimed)}. ${errorCount} item${errorCount === 1 ? '' : 's'} could not be removed.`,
      urgency: 'normal'
    };
  }

  return {
    title: 'DevSweep — Cleanup Complete',
    body: `Reclaimed ${formatBytes(tx.bytesReclaimed)}.`,
    urgency: 'normal'
  };
}
