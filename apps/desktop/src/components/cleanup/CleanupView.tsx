import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trash2,
  HelpCircle,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderOpen,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  Search,
  X,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useScanStore } from '../../stores/useScanStore.js';
import { useHistoryStore } from '../../stores/useHistoryStore.js';
import { useDiskStore } from '../../stores/useDiskStore.js';
import { formatBytes, formatNumber } from '../../lib/format.js';
import { normalizeError } from '../../lib/errorUtils.js';
import {
  CleanupTransaction,
  ScannedItem,
  CleanupProgressEvent,
  SafetyLevel,
  ToolchainId,
  isItemAssociatedWithToolchain,
  getRetryCandidateIds,
  getSafetyExplanation,
  getToolchainAttribution
} from '@cleaner/shared';
import { CleanupProgressModal } from './CleanupProgressModal.js';
import { SafetyBadge } from './SafetyBadge.js';
import { ToolchainBadge } from './ToolchainBadge.js';

interface IndeterminateCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: () => void;
  title?: string;
  ariaLabel?: string;
}

const IndeterminateCheckbox: React.FC<IndeterminateCheckboxProps> = ({
  checked,
  indeterminate,
  disabled = false,
  onChange,
  title,
  ariaLabel
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate, checked]);

  return (
    <input
      type="checkbox"
      role="checkbox"
      ref={inputRef}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      title={title}
      aria-label={ariaLabel || title}
      aria-checked={indeterminate ? 'mixed' : checked}
      className="rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed"
    />
  );
};

export const CleanupView: React.FC = () => {
  const items = useScanStore((s) => s.items);
  const selectedItemIds = useScanStore((s) => s.selectedItemIds);
  const toolchainFilter = useScanStore((s) => s.toolchainFilter);
  const setToolchainFilter = useScanStore((s) => s.setToolchainFilter);
  const toggleItemSelection = useScanStore((s) => s.toggleItemSelection);
  const selectAll = useScanStore((s) => s.selectAll);
  const selectCategory = useScanStore((s) => s.selectCategory);
  const selectItems = useScanStore((s) => s.selectItems);
  const removeItemsAfterCleanup = useScanStore((s) => s.removeItemsAfterCleanup);
  const scanSessionId = useScanStore((s) => s.scanSessionId);
  const scanStatus = useScanStore((s) => s.scanStatus);
  const scannedCandidateCount = useScanStore((s) => s.scannedCandidateCount);
  const currentSessionReclaimed = useScanStore((s) => s.currentSessionReclaimed);
  const scanError = useScanStore((s) => s.error);
  const clearScanError = useScanStore((s) => s.clearError);
  const startScan = useScanStore((s) => s.startScan);

  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const fetchSystemInfo = useDiskStore((s) => s.fetchSystemInfo);

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState<CleanupProgressEvent | null>(null);
  const [lastTransaction, setLastTransaction] = useState<CleanupTransaction | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  // Search & Safety Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [safetyFilter, setSafetyFilter] = useState<'ALL' | 'SAFE' | 'REBUILDABLE' | 'REVIEW'>('ALL');

  const selectedItems = useMemo(() => items.filter((i) => selectedItemIds.has(i.id)), [items, selectedItemIds]);
  const selectedBytes = useMemo(() => selectedItems.reduce((acc, i) => acc + i.size, 0), [selectedItems]);

  // Selected items safety breakdown
  const selectedSafeCount = useMemo(
    () => selectedItems.filter((i) => i.safetyLevel === 'SAFE').length,
    [selectedItems]
  );
  const selectedRebuildableCount = useMemo(
    () => selectedItems.filter((i) => i.safetyLevel === 'REBUILDABLE').length,
    [selectedItems]
  );
  const selectedReviewCount = useMemo(
    () => selectedItems.filter((i) => i.safetyLevel === 'REVIEW').length,
    [selectedItems]
  );

  // Scoped items for active toolchain (if any)
  const toolchainScopedItems = useMemo(() => {
    if (!toolchainFilter) return items;
    return items.filter((i) => isItemAssociatedWithToolchain(i, toolchainFilter));
  }, [items, toolchainFilter]);

  // Candidate counts for filter pills (scoped to active toolchain)
  const totalCount = toolchainScopedItems.length;
  const totalSafeCount = useMemo(() => toolchainScopedItems.filter((i) => i.safetyLevel === 'SAFE').length, [toolchainScopedItems]);
  const totalRebuildableCount = useMemo(() => toolchainScopedItems.filter((i) => i.safetyLevel === 'REBUILDABLE').length, [toolchainScopedItems]);
  const totalReviewCount = useMemo(() => toolchainScopedItems.filter((i) => i.safetyLevel === 'REVIEW').length, [toolchainScopedItems]);
  const totalToolchainBytes = useMemo(() => toolchainScopedItems.reduce((acc, it) => acc + it.size, 0), [toolchainScopedItems]);

  const selectableTotalCount = useMemo(
    () => items.filter((i) => i.safetyLevel !== 'PROTECTED').length,
    [items]
  );
  const isAllSelectableSelected = selectableTotalCount > 0 && selectedItems.length >= selectableTotalCount;

  // Filtered candidate list based on Toolchain AND Safety AND Search
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Toolchain filter
      if (toolchainFilter && !isItemAssociatedWithToolchain(item, toolchainFilter)) {
        return false;
      }

      // 2. Safety filter
      if (safetyFilter === 'SAFE' && item.safetyLevel !== 'SAFE') return false;
      if (safetyFilter === 'REBUILDABLE' && item.safetyLevel !== 'REBUILDABLE') return false;
      if (safetyFilter === 'REVIEW' && item.safetyLevel !== 'REVIEW') return false;

      // 3. Text search (case-insensitive, normalized path separators)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const normalizedQ = q.replace(/[/\\]/g, '/');
        const matchesLabel = (item.label || '').toLowerCase().includes(q);
        const normalizedPath = (item.path || '').toLowerCase().replace(/[/\\]/g, '/');
        const matchesPath = normalizedPath.includes(normalizedQ);
        const matchesRule = (item.ruleId || '').toLowerCase().includes(q);
        const matchesCat = (item.category || '').toLowerCase().includes(q);
        if (!matchesLabel && !matchesPath && !matchesRule && !matchesCat) {
          return false;
        }
      }

      return true;
    });
  }, [items, toolchainFilter, safetyFilter, searchQuery]);

  // Distinct categories present in filtered items
  const activeCategories = useMemo(() => {
    return Array.from(new Set(filteredItems.map((i) => i.category)));
  }, [filteredItems]);

  const handleRevealInExplorer = (itemPath: string) => {
    window.cleaner?.revealInExplorer(itemPath);
  };

  const handleExecuteCleanup = async (targetItemIds?: string[]) => {
    const candidateIds = targetItemIds && targetItemIds.length > 0
      ? targetItemIds
      : selectedItems.map((i) => i.id);

    if (candidateIds.length === 0) return;
    if (!scanSessionId) {
      setCleanupError('Please run a Smart Scan first to generate an active scan session.');
      return;
    }
    setCleanupError(null);
    setShowProgressModal(true);
    setIsExecuting(true);
    setIsPaused(false);
    setCleanupProgress(null);
    setLastTransaction(null);

    let unsubscribe: (() => void) | undefined;
    if (window.cleaner) {
      unsubscribe = window.cleaner.onCleanupProgress((prog) => {
        setCleanupProgress(prog);
        if (prog.status === 'PAUSED') setIsPaused(true);
        else if (prog.status === 'RUNNING') setIsPaused(false);
      });
    }

    try {
      if (window.cleaner) {
        const tx = await window.cleaner.executeCleanup({
          scanSessionId,
          selectedItemIds: candidateIds,
          dryRun
        });

        setLastTransaction(tx);

        if (!dryRun && tx && (tx.deletedCount ?? 0) > 0) {
          const skippedDetails = Array.isArray(tx.skippedDetails) ? tx.skippedDetails : [];
          const skippedPaths = new Set(skippedDetails.map((s: any) => s.path));
          const successfullyDeletedIds = items
            .filter((it) => it && candidateIds.includes(it.id) && !skippedPaths.has(it.path) && !skippedPaths.has(it.id))
            .map((it) => it.id);
          removeItemsAfterCleanup(successfullyDeletedIds);
          await loadHistory();
          await fetchSystemInfo();
        }
      }
    } catch (err: any) {
      setCleanupError(normalizeError(err));
    } finally {
      unsubscribe?.();
      setIsExecuting(false);
    }
  };

  const handlePauseCleanup = async () => {
    if (window.cleaner) {
      await window.cleaner.pauseCleanup();
      setIsPaused(true);
    }
  };

  const handleResumeCleanup = async () => {
    if (window.cleaner) {
      await window.cleaner.resumeCleanup();
      setIsPaused(false);
    }
  };

  const handleCancelCleanup = async () => {
    if (window.cleaner) {
      await window.cleaner.cancelCleanup();
    }
  };

  const handleCloseProgressModal = () => {
    setShowProgressModal(false);
    setCleanupProgress(null);
    setLastTransaction(null);
  };

  const handleRetryFailed = () => {
    if (!lastTransaction) return;
    const retryItemIds = getRetryCandidateIds(lastTransaction, items);
    if (retryItemIds.length > 0) {
      handleExecuteCleanup(retryItemIds);
    }
  };

  const handleSkipFailed = () => {
    setShowProgressModal(false);
    setCleanupProgress(null);
    setLastTransaction(null);
  };

  const renderProgressModal = () => (
    <CleanupProgressModal
      isOpen={showProgressModal}
      isExecuting={isExecuting}
      isPaused={isPaused}
      dryRun={dryRun}
      totalRequestedItems={selectedItems.length || lastTransaction?.totalRequested || 0}
      totalRequestedBytes={selectedBytes || lastTransaction?.bytesReclaimed || 0}
      scannedItems={items}
      progress={cleanupProgress}
      transaction={lastTransaction}
      onPause={handlePauseCleanup}
      onResume={handleResumeCleanup}
      onCancel={handleCancelCleanup}
      onClose={handleCloseProgressModal}
      onRetryFailed={handleRetryFailed}
      onSkipFailed={handleSkipFailed}
    />
  );

  if (items.length === 0) {
    let emptyContent: React.ReactNode = null;

    if (scanStatus === 'FAILED') {
      emptyContent = (
        <div className="p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">Scan Failed</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {scanError || 'The scan encountered an unexpected error and could not complete.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearScanError();
              startScan();
            }}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Retry Smart Scan</span>
          </button>
        </div>
      );
    } else if (scanStatus === 'CANCELLED') {
      emptyContent = (
        <div className="p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Folder className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">Scan Cancelled</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The scan was stopped before it could finish analyzing all developer directories.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startScan()}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Start New Scan</span>
          </button>
        </div>
      );
    } else if (currentSessionReclaimed) {
      emptyContent = (
        <div className="p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">All Selected Caches Reclaimed!</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Selected developer caches were safely removed and disk space was reclaimed. Audit logs of this cleanup are preserved in the History tab.
            </p>
          </div>
          <div className="flex items-center space-x-3 pt-1">
            <button
              type="button"
              onClick={() => startScan()}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run New Scan</span>
            </button>
          </div>
        </div>
      );
    } else if (scanStatus === 'COMPLETED' && scannedCandidateCount === 0) {
      emptyContent = (
        <div className="p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">System Caches are Clean & Pristine</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              DevSweep analyzed your active developer toolchains and found zero redundant cache files or disposable build artifacts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startScan()}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Scan Again</span>
          </button>
        </div>
      );
    } else {
      emptyContent = (
        <div className="p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 rounded-full bg-secondary text-muted-foreground border border-border">
            <Folder className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">No Active Scan Candidates</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Run a Smart Scan from the dashboard to analyze reclaimable developer caches and temporary directories.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startScan()}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Launch Smart Scan</span>
          </button>
        </div>
      );
    }

    return (
      <>
        {emptyContent}
        {renderProgressModal()}
      </>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="p-6 space-y-5 max-w-6xl mx-auto w-full flex-1">
        {/* Cleanup Error Banner */}
        {cleanupError && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between animate-in fade-in duration-150"
          >
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{cleanupError}</span>
            </div>
            <button
              type="button"
              onClick={() => setCleanupError(null)}
              aria-label="Dismiss error"
              className="p-1 hover:opacity-80 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border border-border shadow-xs">
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight">Cleanup Candidates</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review and select developer caches to safely reclaim storage.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => selectAll(!isAllSelectableSelected)}
              className="px-3 py-1.5 text-xs rounded-lg bg-secondary text-foreground hover:bg-secondary/80 border border-border transition-colors cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              {isAllSelectableSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        {/* Active Toolchain Banner */}
        {toolchainFilter && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-xs shadow-xs animate-in fade-in duration-150">
            <div className="flex items-center space-x-2.5">
              <span className="font-semibold text-foreground">Toolchain:</span>
              <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground font-bold uppercase tracking-wider text-[10px]">
                {toolchainFilter}
              </span>
              <span className="text-muted-foreground">
                • {toolchainScopedItems.length} candidate{toolchainScopedItems.length === 1 ? '' : 's'} •{' '}
                {formatBytes(totalToolchainBytes)} reclaimable
              </span>
            </div>

            <button
              type="button"
              onClick={() => setToolchainFilter(null)}
              aria-label="Clear toolchain filter"
              className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15 border border-primary/30 hover:border-primary rounded-lg cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              title="Clear toolchain filter"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Toolchain Filter</span>
            </button>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            {/* Search Box */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    e.stopPropagation();
                    setSearchQuery('');
                  }
                }}
                placeholder="Search by name or path..."
                className="w-full bg-secondary/40 border border-border rounded-lg pl-8.5 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Safety Filter Pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label="Filter by safety classification">
              <button
                type="button"
                aria-pressed={safetyFilter === 'ALL'}
                onClick={() => setSafetyFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden ${
                  safetyFilter === 'ALL'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                All ({totalCount})
              </button>
              <button
                type="button"
                aria-pressed={safetyFilter === 'SAFE'}
                onClick={() => setSafetyFilter('SAFE')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-hidden ${
                  safetyFilter === 'SAFE'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                Safe Only ({totalSafeCount})
              </button>
              <button
                type="button"
                aria-pressed={safetyFilter === 'REBUILDABLE'}
                onClick={() => setSafetyFilter('REBUILDABLE')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-hidden ${
                  safetyFilter === 'REBUILDABLE'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                Rebuildable ({totalRebuildableCount})
              </button>
              <button
                type="button"
                aria-pressed={safetyFilter === 'REVIEW'}
                onClick={() => setSafetyFilter('REVIEW')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-hidden ${
                  safetyFilter === 'REVIEW'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                Review ({totalReviewCount})
              </button>
            </div>
          </div>

          {/* Safety Legend (Compact & Persistent) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 p-2.5 rounded-lg bg-secondary/25 border border-border/60 text-[11px] text-muted-foreground">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-foreground">SAFE:</span>
              <span>Can be removed and regenerated automatically.</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-semibold text-foreground">REBUILDABLE:</span>
              <span>Generated cache/data that development tools can recreate.</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span className="font-semibold text-foreground">REVIEW:</span>
              <span>Removal may affect local state or require additional consideration.</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="font-semibold text-foreground">PROTECTED:</span>
              <span>DevSweep will never allow this item to be selected.</span>
            </div>
          </div>

          {/* Filter Status Indicator */}
          {(toolchainFilter || searchQuery.trim() || safetyFilter !== 'ALL') && (
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>
                Showing <strong className="text-foreground">{filteredItems.length}</strong> of{' '}
                <strong className="text-foreground">{items.length}</strong> candidates
                {toolchainFilter ? ` (scoped to ${toolchainFilter})` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSafetyFilter('ALL');
                  setToolchainFilter(null);
                }}
                className="text-primary hover:underline cursor-pointer text-[11px] rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              >
                Reset all filters
              </button>
            </div>
          )}
        </div>

        {/* Candidates List or Empty Filter State */}
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <Search className="w-6 h-6 text-muted-foreground mx-auto" />
            <h3 className="text-xs font-semibold text-foreground">No matching candidates</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
              No items matched your current criteria
              {safetyFilter !== 'ALL' ? ` (Safety: ${safetyFilter})` : ''}
              {toolchainFilter ? ` (Toolchain: ${toolchainFilter})` : ''}
              {searchQuery ? ` (Search: "${searchQuery}")` : ''}.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSafetyFilter('ALL');
                setToolchainFilter(null);
              }}
              className="text-xs text-primary hover:underline cursor-pointer pt-1 rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {activeCategories.map((category) => {
              const categoryFilteredItems = filteredItems.filter((i) => i.category === category);
              const selectableCategoryItems = categoryFilteredItems.filter((i) => i.safetyLevel !== 'PROTECTED');
              const selectedCategoryItems = selectableCategoryItems.filter((i) => selectedItemIds.has(i.id));

              const isAllSelected =
                selectableCategoryItems.length > 0 && selectedCategoryItems.length === selectableCategoryItems.length;
              const isIndeterminate =
                selectedCategoryItems.length > 0 && selectedCategoryItems.length < selectableCategoryItems.length;
              const isDisabled = selectableCategoryItems.length === 0;

              const handleCategoryToggle = () => {
                if (isAllSelected) {
                  selectItems(selectedCategoryItems.map((i) => i.id), false);
                } else {
                  selectItems(selectableCategoryItems.map((i) => i.id), true);
                }
              };

              return (
                <div key={category} className="bg-card rounded-xl border border-border overflow-hidden shadow-xs">
                  {/* Category Header with Tri-state Checkbox */}
                  <div className="px-4 py-2.5 bg-secondary/40 border-b border-border flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <IndeterminateCheckbox
                        checked={isAllSelected}
                        indeterminate={isIndeterminate}
                        disabled={isDisabled}
                        onChange={handleCategoryToggle}
                        title={
                          isDisabled
                            ? 'No selectable items in category'
                            : isAllSelected
                            ? 'Deselect category'
                            : 'Select category'
                        }
                      />
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        {category}
                      </span>
                    </div>

                    <span className="text-[11px] text-muted-foreground">
                      {selectedCategoryItems.length} of {categoryFilteredItems.length} selected (
                      {formatBytes(categoryFilteredItems.reduce((a, b) => a + b.size, 0))})
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="divide-y divide-border/60">
                    {categoryFilteredItems.map((item) => {
                      const isSelected = selectedItemIds.has(item.id);
                      const isExpanded = expandedItemId === item.id;
                      const isProtected = item.safetyLevel === 'PROTECTED';

                      return (
                        <div key={item.id} className="transition-colors hover:bg-secondary/15">
                          <div className="p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isProtected}
                                onChange={() => toggleItemSelection(item.id)}
                                aria-label={`Select ${item.label}`}
                                className="rounded border-border text-primary cursor-pointer w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-foreground truncate">
                                    {item.label}
                                  </span>
                                  {item.toolchainId && (
                                    <ToolchainBadge
                                      toolchainId={item.toolchainId}
                                      relatedToolchains={item.relatedToolchains}
                                    />
                                  )}
                                  <SafetyBadge level={item.safetyLevel} />
                                </div>
                                <div className="flex items-center space-x-2 mt-0.5">
                                  <p className="text-[11px] text-muted-foreground font-mono truncate" title={item.path}>
                                    {item.path}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => handleRevealInExplorer(item.path)}
                                    title="Reveal in Windows File Explorer"
                                    aria-label={`Reveal ${item.label} in Windows File Explorer`}
                                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center space-x-4 shrink-0">
                              <div className="text-right">
                                <span className="text-xs font-bold text-foreground">{formatBytes(item.size)}</span>
                                <span className="text-[10px] text-muted-foreground block">
                                  {formatNumber(item.fileCount)} files
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                title="Why is this classified this way?"
                                aria-label={`Toggle classification details for ${item.label}`}
                                aria-expanded={isExpanded}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {/* "Why is this classified this way?" Disclosure Card */}
                          {isExpanded && (() => {
                            const safetyExp = getSafetyExplanation(item.safetyLevel);
                            const toolchainAttr = getToolchainAttribution(item.toolchainId, item.relatedToolchains);

                            return (
                              <div className="p-4 bg-secondary/30 border-t border-border/70 text-xs space-y-3 animate-in fade-in duration-100">
                                <div className="flex items-center space-x-1.5 text-primary font-semibold text-xs">
                                  <HelpCircle className="w-3.5 h-3.5" />
                                  <span>Why is this classified this way?</span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                                  {/* Safety Classification */}
                                  <div className="p-2.5 rounded-lg bg-card border border-border space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-foreground">Safety: {safetyExp.label}</span>
                                    </div>
                                    <p className="font-medium text-foreground leading-relaxed">{safetyExp.shortDescription}</p>
                                    <p className="text-muted-foreground leading-relaxed text-[10px]">{safetyExp.detailedDescription}</p>
                                  </div>

                                  {/* Toolchain Attribution */}
                                  {toolchainAttr ? (
                                    <div className="p-2.5 rounded-lg bg-card border border-border space-y-1">
                                      <span className="font-semibold text-foreground block">
                                        Toolchain: {toolchainAttr.primary.displayName}
                                      </span>
                                      <p className="text-muted-foreground leading-relaxed">{toolchainAttr.primary.whyBelongs}</p>
                                      {toolchainAttr.related.length > 0 && (
                                        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                                          Related: {toolchainAttr.related.map((r) => r.displayName).join(', ')}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="p-2.5 rounded-lg bg-card border border-border space-y-1">
                                      <span className="font-semibold text-foreground block">Category</span>
                                      <p className="text-muted-foreground leading-relaxed">{item.category}</p>
                                    </div>
                                  )}

                                  {/* Why is this here? */}
                                  <div className="p-2.5 rounded-lg bg-card border border-border space-y-1">
                                    <span className="font-semibold text-foreground block">Why is this here?</span>
                                    <p className="text-muted-foreground leading-relaxed">{item.explanation?.whyItExists}</p>
                                  </div>

                                  {/* Consequence of Removal */}
                                  <div className="p-2.5 rounded-lg bg-card border border-border space-y-1">
                                    <span className="font-semibold text-foreground block">
                                      {item.safetyLevel === 'PROTECTED' ? 'Protection Status:' : 'Removal Consequence:'}
                                    </span>
                                    <p className="text-muted-foreground leading-relaxed">
                                      {item.safetyLevel === 'PROTECTED'
                                        ? 'DevSweep prevents selection or deletion of this item to guarantee zero data loss.'
                                        : item.explanation?.consequenceOfRemoval}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky Bottom Action Bar (Remains visible during scrolling, decoupled from sidebar width) */}
      <div className="sticky bottom-0 z-20 bg-card border-t border-border shadow-lg">
        <div className="max-w-6xl mx-auto p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div>
              <span className="font-bold text-foreground text-sm">{formatBytes(selectedBytes)}</span>
              <span className="text-muted-foreground"> selected across </span>
              <span className="font-semibold text-foreground">{selectedItems.length} items</span>
            </div>

            <div className="h-3.5 w-px bg-border hidden sm:block" />

            {/* Safety Breakdown */}
            <div className="flex items-center space-x-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/20">
                {selectedSafeCount} Safe
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/20">
                {selectedRebuildableCount} Rebuildable
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold border border-rose-500/20">
                {selectedReviewCount} Review
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            {/* Dry Run Toggle */}
            <label className="flex items-center space-x-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded border-border text-primary cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              />
              <span>Dry Run Simulation</span>
            </label>

            <button
              type="button"
              onClick={() => handleExecuteCleanup()}
              disabled={selectedItems.length === 0 || isExecuting}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{dryRun ? 'Simulate Deletion' : 'Clean Selected Space'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Real-Time Cleanup Progress Deck & Audit Modal */}
      {renderProgressModal()}
    </div>
  );
};
