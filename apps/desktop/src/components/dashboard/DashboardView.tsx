import React, { useState, useMemo } from 'react';
import {
  HardDrive,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  ChevronRight,
  X,
  Info
} from 'lucide-react';
import { useDiskStore } from '../../stores/useDiskStore.js';
import { useScanStore } from '../../stores/useScanStore.js';
import { formatBytes } from '../../lib/format.js';
import { ToolchainId, isItemAssociatedWithToolchain, DetectedEnvironment } from '@cleaner/shared';

const VALID_TOOLCHAINS: Set<string> = new Set<ToolchainId>([
  'node',
  'npm',
  'pnpm',
  'yarn',
  'flutter',
  'gradle',
  'android-sdk',
  'vscode',
  'git',
  'docker',
  'system'
]);

function toToolchainId(id: string): ToolchainId | null {
  return VALID_TOOLCHAINS.has(id) ? (id as ToolchainId) : null;
}

interface DashboardViewProps {
  onStartScan: () => void;
  onNavigateToCleanup: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onStartScan, onNavigateToCleanup }) => {
  const drives = useDiskStore((s) => s.drives);
  const environments = useDiskStore((s) => s.environments);
  const selectedDrive = useDiskStore((s) => s.selectedDrive);
  const setSelectedDrive = useDiskStore((s) => s.setSelectedDrive);
  const fetchSystemInfo = useDiskStore((s) => s.fetchSystemInfo);
  const loading = useDiskStore((s) => s.loading);
  const diskError = useDiskStore((s) => s.error);
  const clearDiskError = useDiskStore((s) => s.clearError);

  const items = useScanStore((s) => s.items);
  const isScanning = useScanStore((s) => s.isScanning);
  const scanStatus = useScanStore((s) => s.scanStatus);
  const setToolchainFilter = useScanStore((s) => s.setToolchainFilter);
  const [selectedEnvForDetail, setSelectedEnvForDetail] = useState<DetectedEnvironment | null>(null);

  const totalScannedBytes = useMemo(
    () => items.reduce((acc, it) => acc + it.size, 0),
    [items]
  );
  const currentDrive = drives.find((d) => d.caption === selectedDrive) || drives[0];

  const scanState: 'NOT_SCANNED' | 'SCANNED_EMPTY' | 'SCANNED_WITH_CANDIDATES' =
    items.length > 0
      ? 'SCANNED_WITH_CANDIDATES'
      : scanStatus === 'COMPLETED'
      ? 'SCANNED_EMPTY'
      : 'NOT_SCANNED';

  const toolchainStatsMap = useMemo(() => {
    const map = new Map<string, { count: number; bytes: number; candidates: typeof items }>();
    if (items.length === 0) return map;
    for (const envId of VALID_TOOLCHAINS) {
      const tid = toToolchainId(envId);
      if (!tid) continue;
      const matching = items.filter((it) => isItemAssociatedWithToolchain(it, tid));
      map.set(envId, {
        count: matching.length,
        bytes: matching.reduce((acc, it) => acc + it.size, 0),
        candidates: matching
      });
    }
    return map;
  }, [items]);

  const getToolchainStats = (envId: string) => {
    return toolchainStatsMap.get(envId) || { count: 0, bytes: 0, candidates: [] };
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">System Drives & Storage</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Find temporary and junk files you can safely clean without touching your work.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchSystemInfo()}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-secondary text-xs text-muted-foreground hover:text-foreground border border-border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Disk Error Recovery Banner */}
      {diskError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between animate-in fade-in duration-150"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Unable to retrieve system drives: {diskError}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => fetchSystemInfo()}
              className="px-2.5 py-1 rounded bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 text-[11px] cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={clearDiskError}
              aria-label="Dismiss error"
              className="p-1 hover:opacity-80 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Drive Overview Card / Skeleton Loader */}
      {loading && drives.length === 0 ? (
        <div
          aria-busy="true"
          aria-label="Loading system drive information"
          className="p-5 rounded-xl bg-card border border-border space-y-4 shadow-sm h-36 flex flex-col justify-between"
        >
          <div className="flex items-center space-x-3" aria-hidden="true">
            <div className="w-10 h-10 rounded-lg bg-secondary/70" />
            <div className="space-y-2">
              <div className="w-32 h-4 rounded bg-secondary/80" />
              <div className="w-48 h-3 rounded bg-secondary/50" />
            </div>
          </div>
          <div className="space-y-2" aria-hidden="true">
            <div className="w-full h-3 rounded-full bg-secondary/70" />
            <div className="flex justify-between">
              <div className="w-20 h-3 rounded bg-secondary/50" />
              <div className="w-24 h-3 rounded bg-secondary/50" />
            </div>
          </div>
        </div>
      ) : currentDrive ? (
        <div className="p-5 rounded-xl bg-card border border-border space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-base font-semibold text-foreground">Drive ({currentDrive.caption})</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {currentDrive.percentUsed}% Used
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatBytes(currentDrive.usedBytes)} used of {formatBytes(currentDrive.totalBytes)} total
                </p>
              </div>
            </div>

            {/* Drive selector if multiple exist */}
            {drives.length > 1 && (
              <div className="flex items-center space-x-1 bg-secondary p-1 rounded-lg">
                {drives.map((d) => (
                  <button
                    key={d.caption}
                    type="button"
                    onClick={() => setSelectedDrive(d.caption)}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden ${
                      selectedDrive === d.caption
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {d.caption}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Drive Usage Bar */}
          <div className="space-y-1.5">
            <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  currentDrive.percentUsed > 90
                    ? 'bg-destructive'
                    : currentDrive.percentUsed > 75
                    ? 'bg-amber-500'
                    : 'bg-primary'
                }`}
                style={{ width: `${Math.min(currentDrive.percentUsed, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{formatBytes(currentDrive.usedBytes)} Used</span>
              <span className="font-medium text-foreground">{formatBytes(currentDrive.freeBytes)} Available</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reclaimable Banner & Scan CTA */}
      <div
        className={`p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
          scanState === 'SCANNED_EMPTY'
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-gradient-to-r from-card to-secondary/30 border-border'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider">
            {scanState === 'SCANNED_EMPTY' ? (
              <div className="flex items-center space-x-1.5 text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Everything Clean & Tidy</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 text-primary">
                <Sparkles className="w-4 h-4" />
                <span>Temporary File Analysis</span>
              </div>
            )}
          </div>
          <h2 className="text-lg font-bold text-foreground">
            {scanState === 'SCANNED_WITH_CANDIDATES'
              ? `${formatBytes(totalScannedBytes)} Ready to Clean`
              : scanState === 'SCANNED_EMPTY'
              ? 'No Junk Files Found'
              : 'Scan for Temporary Files & Caches'}
          </h2>
          <p className="text-xs text-muted-foreground max-w-lg">
            {scanState === 'SCANNED_EMPTY'
              ? 'Your storage is clean and optimal. DevSweep detected zero redundant temporary files or expired caches.'
              : 'Scan safe temporary locations (app caches, build leftovers, and Windows temp) without touching your personal files or projects.'}
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {items.length > 0 && (
            <button
              type="button"
              onClick={onNavigateToCleanup}
              className="px-4 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              Review Files ({items.length})
            </button>
          )}

          <button
            type="button"
            onClick={onStartScan}
            disabled={isScanning}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-md shadow-primary/20 transition-all cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isScanning ? 'Scanning...' : scanState === 'SCANNED_EMPTY' ? 'Run Another Scan' : 'Start Scan'}</span>
          </button>
        </div>
      </div>

      {/* Detected Environments & Interactive Toolchain Cards */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Layers className="w-3.5 h-3.5" />
          <span>Detected Apps & Tools</span>
        </div>

        {loading && environments.length === 0 ? (
          <div
            aria-busy="true"
            aria-label="Detecting developer toolchains"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3"
          >
            {Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                aria-hidden="true"
                className="p-3.5 rounded-xl border border-border/60 bg-card/60 h-28 flex flex-col justify-between"
              >
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 rounded-full bg-secondary/80" />
                  <div className="w-16 h-3 rounded bg-secondary/80" />
                </div>
                <div className="w-20 h-2.5 rounded bg-secondary/60" />
              </div>
            ))}
          </div>
        ) : environments.length === 0 ? (
          <div className="p-6 text-center bg-card rounded-xl border border-border text-xs text-muted-foreground">
            No specialized development tools detected. DevSweep will still clean system temporary files, browser, and editor caches.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {environments.map((env) => {
              const stats = getToolchainStats(env.id);

              return (
                <div
                  key={env.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedEnvForDetail(env)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedEnvForDetail(env);
                    }
                  }}
                  className={`p-3.5 rounded-xl border text-xs flex flex-col justify-between space-y-2.5 transition-all cursor-pointer select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                    env.detected
                      ? 'bg-card border-border hover:border-primary/50 hover:bg-secondary/20 shadow-xs'
                      : 'bg-card/40 border-border/40 text-muted-foreground opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center space-x-2 min-w-0">
                      {env.detected ? (
                        <CheckCircle2 className="w-4 h-4 text-safety-safe shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">{env.name}</div>
                        {env.version ? (
                          <span className="text-[10px] text-muted-foreground truncate block">{env.version}</span>
                        ) : env.detected ? (
                          <span className="text-[10px] text-emerald-400 font-medium block">Detected</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground block">Not found</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                  </div>

                  {/* Intelligence summary */}
                  <div className="pt-1.5 border-t border-border/50 text-[11px]">
                    {scanState === 'NOT_SCANNED' ? (
                      <span className="text-muted-foreground text-[10px] block leading-tight">Needs scan</span>
                    ) : stats.count > 0 ? (
                      <div>
                        <span className="font-bold text-foreground block">{formatBytes(stats.bytes)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {stats.count} cleanable item{stats.count === 1 ? '' : 's'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-[10px] block leading-tight">
                        No temporary files found
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toolchain Detail Popover */}
      {selectedEnvForDetail && (() => {
        const env = selectedEnvForDetail;
        const tid = toToolchainId(env.id);
        const stats = getToolchainStats(env.id);

        const handleReviewInCleanup = () => {
          if (tid) {
            setToolchainFilter(tid);
          }
          setSelectedEnvForDetail(null);
          onNavigateToCleanup();
        };

        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-100"
            onClick={() => setSelectedEnvForDetail(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedEnvForDetail(null);
            }}
          >
            <div
              className="w-full max-w-md bg-card border border-border rounded-xl shadow-xl p-5 space-y-4 text-xs animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{env.name}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {env.version ? `Detected: ${env.version}` : env.detected ? 'Detected on system' : 'Not installed / not in PATH'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedEnvForDetail(null)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Location & Detection Info */}
              {env.installPath && (
                <div className="p-2.5 rounded-lg bg-secondary/30 border border-border text-[11px] space-y-0.5">
                  <span className="font-semibold text-muted-foreground block">Installation Path:</span>
                  <p className="font-mono text-foreground truncate" title={env.installPath}>
                    {env.installPath}
                  </p>
                </div>
              )}

              {/* Scan & Candidates Details */}
              <div className="space-y-2">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                  Cleaning Overview
                </span>

                {scanState === 'NOT_SCANNED' ? (
                  <div className="p-3.5 rounded-lg bg-secondary/20 border border-border text-center space-y-2">
                    <Info className="w-4 h-4 text-primary mx-auto" />
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      Scan needed. Start a scan to discover {env.name} temporary files and caches.
                    </p>
                  </div>
                ) : stats.count > 0 ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2.5 rounded-lg bg-secondary/30 border border-border">
                        <span className="text-muted-foreground text-[10px] block">Cleanable Files</span>
                        <span className="text-sm font-bold text-foreground">{stats.count}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-secondary/30 border border-border">
                        <span className="text-muted-foreground text-[10px] block">Space to Free</span>
                        <span className="text-sm font-bold text-foreground">{formatBytes(stats.bytes)}</span>
                      </div>
                    </div>

                    {/* Detected cache locations found in scan */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-medium text-foreground block">
                        Temporary Cache Locations ({stats.candidates.length}):
                      </span>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                        {stats.candidates.map((c) => (
                          <div
                            key={c.id}
                            className="p-2 rounded bg-secondary/20 border border-border/50 flex items-center justify-between text-[11px]"
                          >
                            <div className="min-w-0 flex-1 mr-2">
                              <span className="font-medium text-foreground truncate block">{c.label}</span>
                              <span className="font-mono text-[10px] text-muted-foreground truncate block" title={c.path}>
                                {c.path}
                              </span>
                            </div>
                            <span className="text-[10px] font-semibold text-foreground shrink-0">{formatBytes(c.size)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-lg bg-secondary/20 border border-border text-center space-y-1">
                    <p className="text-muted-foreground text-[11px]">
                      No temporary {env.name} files found in the current scan.
                    </p>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="pt-2 flex justify-end space-x-2">
                {scanState === 'NOT_SCANNED' ? (
                  <button
                    onClick={() => {
                      setSelectedEnvForDetail(null);
                      onStartScan();
                    }}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Start Cleaning Scan</span>
                  </button>
                ) : stats.count > 0 ? (
                  <button
                    onClick={handleReviewInCleanup}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <span>View in Cleanup</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setSelectedEnvForDetail(null)}
                    className="px-3.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
