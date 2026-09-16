import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  History,
  ShieldCheck,
  AlertCircle,
  Trash2,
  Clock,
  FileSpreadsheet,
  FileJson,
  CheckCircle2,
  Scissors,
  X,
  RotateCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useHistoryStore } from '../../stores/useHistoryStore.js';
import { formatBytes, formatDateTime } from '../../lib/format.js';
import { generateAuditRecords, formatAuditAsJson, formatAuditAsCsv } from '@cleaner/shared';
import { useDialogFocus } from '../../lib/useDialogFocus.js';
import { normalizeError } from '../../lib/errorUtils.js';

export function maskPathPII(text: string): string {
  if (!text) return '';
  return text
    .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s"']+/gi, '$1***')
    .replace(/(\/home\/)[^/\s"']+/gi, '$1***');
}

interface ParsedAuditItem {
  type: 'SAFEGUARD' | 'IN_USE' | 'PERMISSION' | 'SKIPPED';
  badgeStyle: string;
  badgeLabel: string;
  message: string;
  targetPath?: string;
}

function parseAuditReason(rawReason: string, fallbackPath: string): ParsedAuditItem {
  const maskedReason = maskPathPII(rawReason || '');
  const maskedPath = maskPathPII(fallbackPath || '');

  let extractedPath = maskedPath;

  const pathMatch = maskedReason.match(/Path:\s*"([^"]+)"|Path\s+escaped.*?root\s*"([^"]+)"|Path:\s*(\S+)/i);
  if (pathMatch) {
    extractedPath = pathMatch[1] || pathMatch[2] || pathMatch[3] || extractedPath;
  }

  if (/RULE_PROTECTED|policy violation|escaped the approved/i.test(maskedReason)) {
    return {
      type: 'SAFEGUARD',
      badgeStyle: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      badgeLabel: 'SAFEGUARD',
      message: 'Kept safe: Outside the approved cleaning folder',
      targetPath: extractedPath
    };
  }

  if (/EBUSY|File is in use|locked by/i.test(maskedReason)) {
    return {
      type: 'IN_USE',
      badgeStyle: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      badgeLabel: 'IN USE',
      message: 'Currently open or in use by Windows or another app',
      targetPath: extractedPath
    };
  }

  if (/EPERM|access denied|permission denied/i.test(maskedReason)) {
    return {
      type: 'PERMISSION',
      badgeStyle: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      badgeLabel: 'PERMISSION',
      message: 'Administrator permission needed to remove this file',
      targetPath: extractedPath
    };
  }

  return {
    type: 'SKIPPED',
    badgeStyle: 'bg-secondary text-muted-foreground border-border',
    badgeLabel: 'SKIPPED',
    message: 'Skipped safely during cleaning',
    targetPath: extractedPath
  };
}

export const HistoryView: React.FC = () => {
  const { transactions, loadHistory, loading, error, clearError, pruneHistory, clearHistory } = useHistoryStore();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<'prune' | 'clear' | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'PARTIAL' | 'FAILED'>('ALL');
  const [expandedSkippedMap, setExpandedSkippedMap] = useState<Record<string, boolean>>({});

  const toggleSkippedDetails = (txId: string) => {
    setExpandedSkippedMap((prev) => ({
      ...prev,
      [txId]: !prev[txId]
    }));
  };

  const modalRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useDialogFocus(confirmModal !== null, modalRef, {
    initialFocusRef: cancelBtnRef,
    onClose: () => setConfirmModal(null)
  });

  useEffect(() => {
    loadHistory();
  }, []);

  const totalReclaimedLifetime = useMemo(() => {
    return transactions
      .filter((tx) => tx && !tx.dryRun)
      .reduce((acc, tx) => acc + (tx.bytesReclaimed || 0), 0);
  }, [transactions]);

  const { completedCount, partialCount, failedCount } = useMemo(() => {
    let completed = 0;
    let partial = 0;
    let failed = 0;
    for (const t of transactions) {
      if (!t) continue;
      if (t.status === 'COMPLETED') completed++;
      else if (t.status === 'PARTIAL') partial++;
      else if (t.status === 'FAILED') failed++;
    }
    return { completedCount: completed, partialCount: partial, failedCount: failed };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (!t) return false;
      if (statusFilter === 'ALL') return true;
      return t.status === statusFilter;
    });
  }, [transactions, statusFilter]);

  const handleExport = async (format: 'json' | 'csv') => {
    if (transactions.length === 0 || exporting) return;
    setExporting(true);
    setExportFeedback(null);

    try {
      const records = generateAuditRecords(transactions);
      const content = format === 'json' ? formatAuditAsJson(records) : formatAuditAsCsv(records);
      const res = await window.cleaner.exportHistoryFile(format, content);

      if (res?.canceled) {
        setExporting(false);
        return;
      }

      if (res?.success) {
        setExportFeedback({
          type: 'success',
          message: `Cleanup history saved successfully (${format.toUpperCase()}).`
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res?.error ? normalizeError(res.error) : 'Could not save cleanup history.'
        });
      }
    } catch (err) {
      setExportFeedback({
        type: 'error',
        message: normalizeError(err)
      });
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmPrune = async () => {
    setActionInProgress(true);
    try {
      const res = await pruneHistory();
      if (res.success) {
        setExportFeedback({
          type: 'success',
          message:
            res.prunedCount && res.prunedCount > 0
              ? `Removed ${res.prunedCount} older record${res.prunedCount > 1 ? 's' : ''} to keep history clean.`
              : 'Your history is already up to date. No old records needed removal.'
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res.error || 'Could not clean up old history.'
        });
      }
    } finally {
      setActionInProgress(false);
      setConfirmModal(null);
    }
  };

  const handleConfirmClear = async () => {
    setActionInProgress(true);
    try {
      const res = await clearHistory();
      if (res.success) {
        setExportFeedback({
          type: 'success',
          message: `Cleared all ${res.clearedCount || 0} history record${res.clearedCount === 1 ? '' : 's'}.`
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res.error || 'Could not clear history.'
        });
      }
    } finally {
      setActionInProgress(false);
      setConfirmModal(null);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cleanup History</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review past cleanups, freed storage space, and protected files.
          </p>
        </div>
      </div>

      {/* Metric Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-safety-safe/10 text-safety-safe border border-safety-safe/20 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground block truncate">Total Space Freed</span>
            <span className="text-lg font-bold text-foreground tracking-tight block">
              {formatBytes(totalReclaimedLifetime)}
            </span>
            <span className="text-[10px] text-muted-foreground/80 block truncate mt-0.5">
              Cleaned across all sessions
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground block truncate">Cleanups Done</span>
            <span className="text-lg font-bold text-foreground tracking-tight block">
              {transactions.length} Total Cleanup{transactions.length === 1 ? '' : 's'}
            </span>
            <span className="text-[10px] text-muted-foreground/80 block truncate mt-0.5">
              {completedCount} completed · {partialCount} partly cleaned · {failedCount} stopped
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-xs flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-secondary text-muted-foreground border border-border shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground block truncate">Safety Protection</span>
            <span className="text-lg font-bold text-foreground tracking-tight block">
              Safety Shield Active
            </span>
            <span className="text-[10px] text-muted-foreground/80 block truncate mt-0.5">
              Essential files kept safe · Keeps list tidy
            </span>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div
            ref={modalRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            tabIndex={-1}
            className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150 focus-visible:outline-hidden"
          >
            <div className="flex items-center justify-between">
              <h3 id="confirm-modal-title" className="text-base font-bold text-foreground flex items-center gap-2">
                {confirmModal === 'prune' ? (
                  <>
                    <Scissors className="w-5 h-5 text-amber-400" />
                    <span>Clean Up Old History</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 text-destructive" />
                    <span>Clear All History</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={actionInProgress}
                aria-label="Close dialog"
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {confirmModal === 'prune' ? (
                <>
                  This removes older cleanup records to keep your list organized and save storage space. Your most recent cleanup records will remain safely saved.
                </>
              ) : (
                <>
                  Remove all past cleanup records from this list? <br />
                  <strong className="text-foreground block mt-1">
                    This only removes the log history. It will NOT delete your actual files, projects, or saved reports.
                  </strong>
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={actionInProgress}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal === 'prune' ? handleConfirmPrune : handleConfirmClear}
                disabled={actionInProgress}
                className={`px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-card focus-visible:outline-hidden ${
                  confirmModal === 'prune'
                    ? 'bg-amber-600 hover:bg-amber-500 focus-visible:ring-amber-500'
                    : 'bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive'
                }`}
              >
                {confirmModal === 'prune' ? 'Clean Up Old Records' : 'Clear All History'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Feedback */}
      {exportFeedback && (
        <div
          role={exportFeedback.type === 'error' ? 'alert' : 'status'}
          aria-live={exportFeedback.type === 'error' ? 'assertive' : 'polite'}
          className={`p-3 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-200 ${
            exportFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-destructive/10 border-destructive/20 text-destructive'
          }`}
        >
          <div className="flex items-center gap-2">
            {exportFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
            )}
            <span>{exportFeedback.message}</span>
          </div>
          <button
            onClick={() => setExportFeedback(null)}
            className="text-[11px] underline hover:no-underline ml-4 cursor-pointer opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* History Load Error */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between text-xs text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
            <div>
              <span className="font-semibold block">Couldn't load cleanup history</span>
              <span>{error}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearError();
              loadHistory();
            }}
            className="px-3 py-1.5 bg-destructive/20 hover:bg-destructive/30 font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Action & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* Status Filter Segmented Control */}
        <div
          className="inline-flex items-center p-1 rounded-lg bg-secondary/40 border border-border/60 gap-1"
          role="toolbar"
          aria-label="Filter cleanup records by status"
        >
          {(
            [
              { key: 'ALL', label: 'All', count: transactions.length },
              { key: 'COMPLETED', label: 'Completed', count: completedCount },
              { key: 'PARTIAL', label: 'Partly Cleaned', count: partialCount },
              { key: 'FAILED', label: 'Stopped', count: failedCount }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden ${
                statusFilter === tab.key
                  ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
              aria-pressed={statusFilter === tab.key}
            >
              {tab.label} <span className="text-[10px] opacity-75">({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            type="button"
            onClick={() => handleExport('json')}
            disabled={transactions.length === 0 || exporting || actionInProgress}
            className="h-8 px-3 bg-secondary/60 hover:bg-secondary text-foreground text-xs font-medium rounded-lg border border-border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            title="Save cleanup history as a JSON file"
          >
            <FileJson className="w-3.5 h-3.5 text-primary" />
            <span>Save JSON</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={transactions.length === 0 || exporting || actionInProgress}
            className="h-8 px-3 bg-secondary/60 hover:bg-secondary text-foreground text-xs font-medium rounded-lg border border-border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            title="Save cleanup history as an Excel/CSV spreadsheet"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Save CSV</span>
          </button>
          <div className="h-4 w-[1px] bg-border mx-0.5 hidden sm:block" />
          <button
            type="button"
            onClick={() => setConfirmModal('prune')}
            disabled={transactions.length === 0 || exporting || actionInProgress}
            className="h-8 px-3 bg-secondary/40 hover:bg-secondary/80 text-foreground text-xs font-medium rounded-lg border border-border/80 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-hidden"
            title="Remove older records to keep your history organized"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Clean Old Logs</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmModal('clear')}
            disabled={transactions.length === 0 || exporting || actionInProgress}
            className="h-8 px-3 bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium rounded-lg border border-destructive/20 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
            title="Remove all past cleanup records from this list"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear All</span>
          </button>
        </div>
      </div>

      {/* Transactions List / Loading / Empty */}
      <div className="space-y-3">
        {loading && transactions.length === 0 ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading history records">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-card/60 rounded-xl border border-border space-y-3" tabIndex={-1}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-secondary/70" />
                    <div className="space-y-1.5">
                      <div className="w-32 h-3.5 bg-secondary/80 rounded" />
                      <div className="w-24 h-2.5 bg-secondary/50 rounded" />
                    </div>
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="w-16 h-4 bg-secondary/80 rounded ml-auto" />
                    <div className="w-24 h-2.5 bg-secondary/50 rounded ml-auto" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto" />
            <h3 className="text-sm font-semibold text-foreground">No Cleanup History Yet</h3>
            <p className="text-xs text-muted-foreground">Records of your cleaned files and freed space will appear here.</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-8 text-center bg-card rounded-xl border border-border space-y-2">
            <Clock className="w-6 h-6 text-muted-foreground mx-auto" />
            <h3 className="text-xs font-semibold text-foreground">No records found</h3>
            <p className="text-[11px] text-muted-foreground">Try selecting a different filter above.</p>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div key={tx.transactionId} className="p-4 bg-card rounded-xl border border-border space-y-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                      tx.dryRun
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : tx.status === 'COMPLETED'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : tx.status === 'PARTIAL'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}
                  >
                    {tx.status === 'COMPLETED' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : tx.status === 'PARTIAL' ? (
                      <AlertCircle className="w-4 h-4" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {tx.ruleId === 'BATCH_ALL' ? 'All Selected Cleanups' : tx.ruleId}
                      </span>
                      {tx.dryRun && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30">
                          PREVIEW (NO FILES DELETED)
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                          tx.status === 'COMPLETED'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                            : tx.status === 'PARTIAL'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {tx.status === 'COMPLETED' ? 'COMPLETED' : tx.status === 'PARTIAL' ? 'PARTLY CLEANED' : 'STOPPED'}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      {formatDateTime(tx.startedAt)}
                    </span>
                  </div>
                </div>

                <div className="text-left sm:text-right flex sm:flex-col justify-between sm:justify-center items-start sm:items-end">
                  <span className="text-sm font-bold text-primary tracking-tight">
                    {formatBytes(tx.bytesReclaimed)} Freed
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-secondary text-foreground/80 font-medium">
                      {tx.deletedCount} files removed
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-secondary text-muted-foreground font-medium">
                      {tx.skippedCount} files kept safe
                    </span>
                  </div>
                </div>
              </div>

              {/* Skipped Details Accordion if any */}
              {(() => {
                const skippedList = Array.isArray(tx.skippedDetails) ? tx.skippedDetails : [];
                if (skippedList.length === 0) return null;
                const isExpanded = !!expandedSkippedMap[tx.transactionId];
                return (
                  <div className="pt-2.5 border-t border-border/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          Files Kept Safe & Untouched
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-secondary text-muted-foreground font-medium">
                          {skippedList.length} file{skippedList.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSkippedDetails(tx.transactionId)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-2 py-0.5 rounded-md bg-secondary/50 hover:bg-secondary border border-border/50 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} details for kept files`}
                      >
                        {isExpanded ? (
                          <>
                            <span>Hide Details</span>
                            <ChevronUp className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            <span>Show Details</span>
                            <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>

                    <div
                      className={`overflow-y-auto space-y-1.5 transition-all duration-200 pr-1 ${
                        isExpanded ? 'max-h-72' : 'max-h-24'
                      }`}
                    >
                      {skippedList.map((s: { path: string; reason: string }, idx: number) => {
                        const parsed = parseAuditReason(s?.reason || '', s?.path || '');
                        return (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-secondary/30 border border-border/40 text-xs flex flex-col gap-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-semibold border ${parsed.badgeStyle}`}>
                                {parsed.badgeLabel}
                              </span>
                              <span className="text-foreground/90 font-medium text-[11px] truncate">
                                {parsed.message}
                              </span>
                            </div>
                            {parsed.targetPath && (
                              <div className="font-mono text-[10px] text-muted-foreground/80 truncate pl-0.5 select-all">
                                {parsed.targetPath}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
