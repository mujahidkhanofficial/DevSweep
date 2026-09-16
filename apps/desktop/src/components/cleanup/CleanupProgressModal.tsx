import React, { useState, useMemo, useRef } from 'react';
import {
  Trash2,
  Pause,
  Play,
  Square,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  HardDrive,
  Folder,
  ShieldCheck,
  ExternalLink,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  XCircle,
  FileText
} from 'lucide-react';
import {
  CleanupProgressEvent,
  CleanupTransaction,
  ScannedItem,
  diagnoseLockedFiles
} from '@cleaner/shared';
import { formatBytes, formatNumber } from '../../lib/format.js';
import { LockedFileRemediationCard } from './LockedFileRemediationCard.js';
import { useDialogFocus } from '../../lib/useDialogFocus.js';

interface CleanupProgressModalProps {
  isOpen: boolean;
  isExecuting: boolean;
  isPaused: boolean;
  dryRun: boolean;
  totalRequestedItems?: number;
  totalRequestedBytes?: number;
  scannedItems?: ScannedItem[];
  progress: CleanupProgressEvent | null;
  transaction: CleanupTransaction | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClose: () => void;
  onRetryFailed?: () => void;
  onSkipFailed?: () => void;
}

export const CleanupProgressModal: React.FC<CleanupProgressModalProps> = ({
  isOpen,
  isExecuting,
  isPaused,
  dryRun,
  totalRequestedItems = 0,
  totalRequestedBytes = 0,
  scannedItems = [],
  progress,
  transaction,
  onPause,
  onResume,
  onCancel,
  onClose,
  onRetryFailed,
  onSkipFailed
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocus(isOpen, dialogRef, {
    onClose: isExecuting ? onCancel : onClose
  });

  // Session-level metrics
  const totalItems = progress?.totalItems || totalRequestedItems || transaction?.totalRequested || 1;
  const processedItems = progress?.processedItems ?? (
    (transaction?.deletedCount ?? 0) + (transaction?.skippedCount ?? 0) + (transaction?.failedCount ?? 0)
  );
  const itemsLeft = progress?.itemsLeft ?? Math.max(0, totalItems - processedItems);
  const sessionPercent = Math.min(Math.round((processedItems / totalItems) * 100), 100);

  const bytesReclaimed = progress?.bytesReclaimed ?? transaction?.bytesReclaimed ?? 0;
  const totalBytes = progress?.totalBytesToReclaim || totalRequestedBytes || transaction?.bytesReclaimed || 0;

  // Active item hierarchical metrics
  const activeName = progress?.activeItemName || progress?.currentItemName || 'Preparing item...';
  const activePath = progress?.activeItemPath || progress?.currentPath || '';
  const activeState = progress?.activeItemState || progress?.status || 'RUNNING';
  const currentOp = progress?.currentOperation || (isExecuting ? 'Processing target...' : 'Finished');
  const discoveryState = progress?.discoveryState || 'PROCESSING';
  const filesDiscovered = progress?.filesDiscovered ?? 0;
  const filesProcessed = progress?.filesProcessed ?? 0;
  const filesDeleted = progress?.filesDeleted ?? 0;
  const filesSkipped = progress?.filesSkipped ?? 0;
  const heartbeatStatus = progress?.heartbeatStatus || 'ACTIVE';

  // Terminal status
  const txStatus = transaction?.status;
  const isCompleted = !isExecuting && txStatus === 'COMPLETED';
  const isPartial = !isExecuting && txStatus === 'PARTIAL';
  const isCancelled = !isExecuting && txStatus === 'CANCELLED';
  const isFailed = !isExecuting && txStatus === 'FAILED';

  const skippedDetails = transaction?.skippedDetails || [];
  const hasFailedOrSkipped = skippedDetails.length > 0 || (transaction?.failedCount ?? 0) > 0 || isPartial;

  const diagnosis = useMemo(() => {
    if (!skippedDetails.length) return null;
    return diagnoseLockedFiles(skippedDetails, scannedItems);
  }, [skippedDetails, scannedItems]);

  const formatRemainingTime = (ms: number) => {
    if (!ms || ms <= 0) return 'Estimating...';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `~${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const remSecs = seconds % 60;
    return `~${mins}m ${remSecs}s remaining`;
  };

  const handleRevealInExplorer = (itemPath: string) => {
    if (itemPath && window.cleaner) {
      window.cleaner.revealInExplorer(itemPath);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-modal-title"
        tabIndex={-1}
        className="bg-card border border-border rounded-xl p-6 w-full max-w-xl shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 focus-visible:outline-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isExecuting && !isPaused ? (
              <div className="p-2 rounded-lg bg-destructive/15 text-destructive animate-pulse">
                <Trash2 className="w-5 h-5" />
              </div>
            ) : isPaused ? (
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400">
                <Pause className="w-5 h-5" />
              </div>
            ) : isCancelled ? (
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
            ) : isPartial ? (
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
            ) : isFailed ? (
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400">
                <XCircle className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            )}

            <div>
              <h3 id="cleanup-modal-title" className="text-sm font-bold text-foreground">
                {isExecuting
                  ? isPaused
                    ? 'Cleanup Suspended (Paused)'
                    : dryRun
                    ? 'Simulating Deletion (Dry Run)'
                    : 'Executing Cleanup'
                  : isCancelled
                  ? 'Cleanup Stopped by User'
                  : isPartial
                  ? 'Cleanup completed with some items skipped'
                  : isFailed
                  ? 'Cleanup Failed'
                  : dryRun
                  ? 'Dry Run Simulation Complete'
                  : 'Cleanup Completed Successfully'}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isExecuting
                  ? `Overall: ${processedItems} / ${totalItems} items processed • ${itemsLeft} remaining`
                  : `${transaction?.deletedCount ?? 0} items deleted • ${transaction?.skippedCount ?? 0} skipped • ${transaction?.failedCount ?? 0} failed`}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {dryRun && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-secondary text-primary border border-border">
                Dry Run
              </span>
            )}
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-secondary text-foreground border border-border">
              {sessionPercent}%
            </span>
          </div>
        </div>

        {/* ACTIVE ITEM CARD (Hierarchical Progress) */}
        {isExecuting && (
          <div className="p-4 rounded-xl bg-secondary/40 border border-border/80 space-y-3">
            {/* Primary: Target Name */}
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                  Active Target
                </div>
                <div className="text-sm font-bold text-foreground truncate flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate">{activeName}</span>
                </div>
              </div>

              {/* Heartbeat Status Indicator */}
              <div className="shrink-0 flex items-center gap-1.5">
                {heartbeatStatus === 'SLOW' || heartbeatStatus === 'STALLED' ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
                    {heartbeatStatus === 'STALLED' ? 'I/O Waiting' : 'Busy I/O'}
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
                    {activeState}
                  </span>
                )}
              </div>
            </div>

            {/* Path Breadcrumb */}
            {activePath && (
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground font-mono bg-background/60 px-2.5 py-1 rounded-md border border-border/40">
                <span className="truncate" title={activePath}>
                  {activePath}
                </span>
                <button
                  onClick={() => handleRevealInExplorer(activePath)}
                  title="Reveal in Explorer"
                  className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer p-0.5"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Secondary: Real-Time File Counter */}
            <div className="rounded-lg bg-background/40 p-2.5 border border-border/40 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">
                  {discoveryState === 'DISCOVERING' ? (
                    'Scanning directory…'
                  ) : filesDiscovered > 0 ? (
                    <>
                      Files processed:{' '}
                      <span className="font-semibold text-foreground">
                        {formatNumber(filesProcessed)} / {formatNumber(filesDiscovered)}
                      </span>
                    </>
                  ) : (
                    <>
                      Files processed:{' '}
                      <span className="font-semibold text-foreground">
                        {formatNumber(filesProcessed)}
                      </span>
                    </>
                  )}
                </span>

                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-emerald-400">✓ {formatNumber(filesDeleted)} deleted</span>
                  {filesSkipped > 0 && (
                    <span className="text-amber-400">⚠ {formatNumber(filesSkipped)} skipped</span>
                  )}
                </div>
              </div>

              {/* Status Operation Ticker */}
              <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                <span className="italic truncate">
                  {heartbeatStatus === 'SLOW' || heartbeatStatus === 'STALLED'
                    ? 'Filesystem is taking longer than expected…'
                    : currentOp}
                </span>
                {filesDiscovered > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                    {Math.min(100, Math.round((filesProcessed / Math.max(1, filesDiscovered)) * 100))}%
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Session Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden border border-border/40">
            <div
              className={`h-full transition-all duration-200 rounded-full ${
                isPaused
                  ? 'bg-amber-400'
                  : isCompleted
                  ? 'bg-emerald-400'
                  : isPartial
                  ? 'bg-amber-400'
                  : isCancelled
                  ? 'bg-amber-500'
                  : isFailed
                  ? 'bg-rose-500'
                  : 'bg-primary'
              }`}
              style={{ width: `${sessionPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>Overall: {processedItems} / {totalItems} items</span>
            <span>{isCompleted ? 'Complete' : `${itemsLeft} remaining`}</span>
          </div>
        </div>

        {/* Real-time Telemetry Grid */}
        <div className="grid grid-cols-3 gap-2.5 text-xs">
          {/* Reclaimed Space */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/60 space-y-1">
            <div className="flex items-center space-x-1.5 text-muted-foreground text-[11px]">
              <HardDrive className="w-3.5 h-3.5 text-primary" />
              <span>Reclaimed</span>
            </div>
            <div className="text-base font-bold text-foreground">
              {formatBytes(bytesReclaimed)}
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              Target: {formatBytes(totalBytes)}
            </span>
          </div>

          {/* Items Remaining */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/60 space-y-1">
            <div className="flex items-center space-x-1.5 text-muted-foreground text-[11px]">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Items Left</span>
            </div>
            <div className="text-base font-bold text-foreground">
              {itemsLeft}{' '}
              <span className="text-xs font-normal text-muted-foreground">remaining</span>
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              {itemsLeft > 0 ? `${itemsLeft} items in queue` : 'Queue drained'}
            </span>
          </div>

          {/* Speed & Remaining Time */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/60 space-y-1">
            <div className="flex items-center space-x-1.5 text-muted-foreground text-[11px]">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Speed & Time</span>
            </div>
            <div className="text-base font-bold text-foreground truncate">
              {progress?.bytesPerSecond ? `${formatBytes(progress.bytesPerSecond)}/s` : 'Active'}
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              {isExecuting && !isPaused
                ? formatRemainingTime(progress?.estimatedRemainingTimeMs || 0)
                : isPaused
                ? 'Suspended'
                : 'Finished'}
            </span>
          </div>
        </div>

        {/* Actionable Locked-File Remediation Guidance */}
        {!isExecuting && diagnosis && (
          <LockedFileRemediationCard
            diagnosis={diagnosis}
            onRetry={onRetryFailed || (() => {})}
            onSkip={onSkipFailed || onClose}
            onRevealInExplorer={handleRevealInExplorer}
          />
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          {isExecuting ? (
            <div className="flex items-center space-x-2">
              {isPaused ? (
                <button
                  type="button"
                  onClick={onResume}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume Cleanup</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPause}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Cleanup</span>
                </button>
              )}

              <button
                type="button"
                onClick={onCancel}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-secondary hover:bg-destructive/15 text-muted-foreground hover:text-destructive text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Cancel Cleanup</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* Remediation actions are in LockedFileRemediationCard */}
            </div>
          )}

          {!isExecuting && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer ml-auto focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card focus-visible:outline-hidden"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
