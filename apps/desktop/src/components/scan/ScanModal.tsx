import React, { useRef, useEffect } from 'react';
import { RefreshCw, Play, Pause, Square, CheckCircle2, ShieldAlert, Clock, Zap, HardDrive, AlertCircle } from 'lucide-react';
import { useScanStore } from '../../stores/useScanStore.js';
import { formatBytes, formatNumber } from '../../lib/format.js';
import { useDialogFocus } from '../../lib/useDialogFocus.js';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScanModal: React.FC<ScanModalProps> = ({ isOpen, onClose }) => {
  const {
    isScanning,
    isPaused,
    progress,
    pauseScan,
    resumeScan,
    cancelScan,
    isCancelled,
    items,
    scanStatus,
    error,
    startScan,
    clearError
  } = useScanStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reviewBtnRef = useRef<HTMLButtonElement>(null);

  const isModalActive = Boolean(isOpen || isScanning);
  useDialogFocus(isModalActive, dialogRef, { onClose });

  useEffect(() => {
    if (!isScanning && isModalActive) {
      // Invariant: Only move focus to review button if the modal currently owns focus. Never steal focus from the background!
      if (dialogRef.current?.contains(document.activeElement)) {
        reviewBtnRef.current?.focus();
      }
    }
  }, [isScanning, isModalActive]);

  if (!isOpen && !isScanning && scanStatus !== 'FAILED') return null;

  const currentRuleIdx = progress?.currentRuleIndex || 1;
  const totalRules = progress?.totalRules || 8;
  const percentComplete = Math.min(Math.round(((currentRuleIdx - 1) / totalRules) * 100), 100);

  const formatRemainingTime = (ms: number) => {
    if (!ms || ms <= 0) return 'Estimating...';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `~${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const remSecs = seconds % 60;
    return `~${mins}m ${remSecs}s remaining`;
  };

  const isFailed = scanStatus === 'FAILED';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-modal-title"
        tabIndex={-1}
        className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150 focus-visible:outline-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            {isScanning && !isPaused ? (
              <RefreshCw className="w-5 h-5 text-primary animate-spin" />
            ) : isPaused ? (
              <Pause className="w-5 h-5 text-amber-400" />
            ) : isFailed ? (
              <AlertCircle className="w-5 h-5 text-destructive" />
            ) : isCancelled ? (
              <ShieldAlert className="w-5 h-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-safety-safe" />
            )}
            <div>
              <h3 id="scan-modal-title" className="text-sm font-bold text-foreground">
                {isScanning
                  ? isPaused
                    ? 'Scan Paused'
                    : `Scanning: ${progress?.currentRule || 'Temporary Files'}`
                  : isFailed
                  ? 'Scan Failed'
                  : isCancelled
                  ? 'Scan Cancelled'
                  : 'Scan Complete!'}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {isScanning
                  ? `Step ${currentRuleIdx} of ${totalRules} • ${progress?.currentCategory || 'Scanning'}`
                  : isFailed
                  ? 'The scanner encountered an unexpected error.'
                  : isCancelled
                  ? 'Scan was stopped before completion.'
                  : items.length === 0
                  ? 'All safe locations checked — no junk files found'
                  : `${items.length} cleanable item(s) found`}
              </p>
            </div>
          </div>

          {isScanning && (
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-secondary text-primary border border-border">
              {percentComplete}%
            </span>
          )}
        </div>

        {/* Error Alert Box if Failed */}
        {isFailed && error && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-1"
          >
            <span className="font-semibold block">Scan Error Details:</span>
            <p className="text-destructive/90 leading-relaxed font-mono text-[11px]">{error}</p>
          </div>
        )}

        {/* Multi-stage Progress Bar */}
        {!isFailed && (
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isPaused ? 'bg-amber-400' : 'bg-primary'
              }`}
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        )}

        {/* Telemetry Grid */}
        {!isFailed && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-lg bg-secondary/40 border border-border/50 space-y-1">
              <div className="flex items-center space-x-1.5 text-muted-foreground text-[11px]">
                <HardDrive className="w-3.5 h-3.5" />
                <span>Cleanable Space Found</span>
              </div>
              <div className="text-base font-bold text-foreground">
                {formatBytes(progress?.scannedBytes || 0)}
              </div>
              <span className="text-[10px] text-muted-foreground block truncate">
                {formatNumber(progress?.scannedFiles || 0)} files checked
              </span>
            </div>

            <div className="p-3 rounded-lg bg-secondary/40 border border-border/50 space-y-1">
              <div className="flex items-center space-x-1.5 text-muted-foreground text-[11px]">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Scan Speed</span>
              </div>
              <div className="text-base font-bold text-foreground">
                {formatNumber(progress?.filesPerSecond || 0)}{' '}
                <span className="text-xs font-normal text-muted-foreground">files/s</span>
              </div>
              <span className="text-[10px] text-muted-foreground block truncate">
                {formatBytes(progress?.bytesPerSecond || 0)}/s speed
              </span>
            </div>
          </div>
        )}

        {/* Dynamic ETA / Time Info */}
        {!isFailed && (
          <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground">
            <div className="flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {isScanning && !isPaused
                  ? formatRemainingTime(progress?.estimatedRemainingTimeMs || 0)
                  : isPaused
                  ? 'Scan is suspended'
                  : 'Finished'}
              </span>
            </div>
            {progress?.elapsedTimeMs ? (
              <span>Elapsed: {Math.round(progress.elapsedTimeMs / 1000)}s</span>
            ) : null}
          </div>
        )}

        {/* Active directory ticker */}
        {progress?.currentPath && isScanning && (
          <div
            className="text-[10px] text-muted-foreground font-mono truncate px-2 py-1 rounded bg-secondary/30 border border-border/40"
            title={progress.currentPath}
          >
            {progress.currentPath}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-1">
          {isScanning ? (
            <div className="flex items-center space-x-2">
              {isPaused ? (
                <button
                  type="button"
                  onClick={() => resumeScan()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => pauseScan()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => cancelScan()}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-destructive/15 text-muted-foreground hover:text-destructive text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </div>
          ) : isFailed ? (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  clearError();
                  onClose();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div />
          )}

          {!isScanning && (
            isFailed ? (
              <button
                ref={reviewBtnRef}
                type="button"
                onClick={() => {
                  clearError();
                  startScan();
                }}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card focus-visible:outline-hidden"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Scan</span>
              </button>
            ) : (
              <button
                ref={reviewBtnRef}
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card focus-visible:outline-hidden"
              >
                {items.length > 0 ? `Review ${items.length} Cleanable Items` : 'Close'}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};
