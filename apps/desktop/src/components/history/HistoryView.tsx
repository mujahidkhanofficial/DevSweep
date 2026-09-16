import React, { useEffect, useState, useRef } from 'react';
import {
  History,
  ShieldCheck,
  AlertCircle,
  Trash2,
  Clock,
  Download,
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

  const totalReclaimedLifetime = transactions
    .filter((tx) => tx && !tx.dryRun)
    .reduce((acc, tx) => acc + (tx.bytesReclaimed || 0), 0);

  const completedCount = transactions.filter((t) => t && t.status === 'COMPLETED').length;
  const partialCount = transactions.filter((t) => t && t.status === 'PARTIAL').length;
  const failedCount = transactions.filter((t) => t && t.status === 'FAILED').length;

  const filteredTransactions = transactions.filter((t) => {
    if (!t) return false;
    if (statusFilter === 'ALL') return true;
    return t.status === statusFilter;
  });

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
          message: `Audit exported successfully (${format.toUpperCase()}).`
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res?.error ? normalizeError(res.error) : 'Could not export audit history.'
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
              ? `Pruned ${res.prunedCount} record${res.prunedCount > 1 ? 's' : ''} according to retention settings.`
              : 'History already conforms to your retention policy. No records pruned.'
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res.error || 'Could not prune history.'
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
          message: `Cleared all ${res.clearedCount || 0} historical audit record${res.clearedCount === 1 ? '' : 's'}.`
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cleanup Audit & History</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Local audit records of all previous cleanup transactions and space reclaimed.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Export & Retention Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleExport('json')}
              disabled={transactions.length === 0 || exporting || actionInProgress}
              className="px-3 py-2 bg-secondary/80 hover:bg-secondary text-foreground text-xs font-medium rounded-lg border border-border flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              title="Export history audit trail as versioned JSON"
            >
              <FileJson className="w-4 h-4 text-primary" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={transactions.length === 0 || exporting || actionInProgress}
              className="px-3 py-2 bg-secondary/80 hover:bg-secondary text-foreground text-xs font-medium rounded-lg border border-border flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              title="Export history audit trail as RFC-4180 CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmModal('prune')}
              disabled={transactions.length === 0 || exporting || actionInProgress}
              className="px-3 py-2 bg-secondary/80 hover:bg-secondary text-foreground text-xs font-medium rounded-lg border border-border flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-hidden"
              title="Prune history older than configured retention period"
            >
              <Scissors className="w-4 h-4 text-amber-400" />
              <span>Prune</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmModal('clear')}
              disabled={transactions.length === 0 || exporting || actionInProgress}
              className="px-3 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium rounded-lg border border-destructive/20 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
              title="Permanently remove stored history records"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear</span>
            </button>
          </div>

          <div className="p-3 bg-secondary/50 border border-border rounded-xl flex items-center space-x-3 text-xs">
            <ShieldCheck className="w-5 h-5 text-safety-safe" />
            <div>
              <span className="text-[10px] text-muted-foreground block">Lifetime Reclaimed Space</span>
              <span className="font-bold text-foreground text-sm">{formatBytes(totalReclaimedLifetime)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            ref={modalRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            tabIndex={-1}
            className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 focus-visible:outline-hidden"
          >
            <div className="flex items-center justify-between">
              <h3 id="confirm-modal-title" className="text-base font-bold text-foreground flex items-center gap-2">
                {confirmModal === 'prune' ? (
                  <>
                    <Scissors className="w-5 h-5 text-amber-400" />
                    <span>Prune Audit History</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 text-destructive" />
                    <span>Clear Audit History</span>
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
                  This will remove historical records that exceed your configured retention policy (age and maximum count limits). Records with uninterpretable timestamps are safely kept.
                </>
              ) : (
                <>
                  Permanently remove all stored audit history records? <br />
                  <strong className="text-foreground block mt-1">
                    This affects stored audit logs only. It does not delete downloaded/developer files or exported audit files.
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
                {confirmModal === 'prune' ? 'Confirm Prune' : 'Confirm Clear All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Status Feedback */}
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
              <span className="font-semibold block">Failed to load history</span>
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
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Status Filter Toolbar */}
      {transactions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Filter audit records by status">
          {(
            [
              { key: 'ALL', label: 'All', count: transactions.length },
              { key: 'COMPLETED', label: 'Completed', count: completedCount },
              { key: 'PARTIAL', label: 'Partial', count: partialCount },
              { key: 'FAILED', label: 'Failed', count: failedCount }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden ${
                statusFilter === tab.key
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
              }`}
              aria-pressed={statusFilter === tab.key}
            >
              {tab.label} <span className="opacity-70 text-[10px]">({tab.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Transactions List / Loading / Empty */}
      <div className="space-y-3">
        {loading && transactions.length === 0 ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading history records">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-card/60 rounded-xl border border-border space-y-3 animate-pulse" tabIndex={-1}>
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
            <p className="text-xs text-muted-foreground">Completed cleanup transactions will appear here.</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-8 text-center bg-card rounded-xl border border-border space-y-2">
            <Clock className="w-6 h-6 text-muted-foreground mx-auto" />
            <h3 className="text-xs font-semibold text-foreground">No {statusFilter.toLowerCase()} records found</h3>
            <p className="text-[11px] text-muted-foreground">Try selecting a different status filter above.</p>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div key={tx.transactionId} className="p-4 bg-card rounded-xl border border-border space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <div
                    className={`p-2 rounded-lg ${
                      tx.dryRun
                        ? 'bg-purple-500/10 text-purple-400'
                        : tx.status === 'COMPLETED'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : tx.status === 'PARTIAL'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-foreground">
                        {tx.ruleId === 'BATCH_ALL' ? 'Multi-Rule Batch Cleanup' : tx.ruleId}
                      </span>
                      {tx.dryRun && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-purple-500/20 text-purple-300 font-semibold">
                          DRY RUN
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${
                          tx.status === 'COMPLETED'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                            : tx.status === 'PARTIAL'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(tx.startedAt)}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-bold text-primary">{formatBytes(tx.bytesReclaimed)}</span>
                  <span className="text-[10px] text-muted-foreground block">
                    {tx.deletedCount} deleted, {tx.skippedCount} skipped
                  </span>
                </div>
              </div>

              {/* Skipped Details Accordion if any */}
              {(() => {
                const skippedList = Array.isArray(tx.skippedDetails) ? tx.skippedDetails : [];
                if (skippedList.length === 0) return null;
                return (
                  <div className="pt-2 border-t border-border/60 text-[11px] space-y-1.5 text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        Skipped Files Audit ({skippedList.length}):
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleSkippedDetails(tx.transactionId)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                        aria-expanded={!!expandedSkippedMap[tx.transactionId]}
                        aria-label={`${expandedSkippedMap[tx.transactionId] ? 'Collapse' : 'Expand'} skipped files list`}
                      >
                        {expandedSkippedMap[tx.transactionId] ? (
                          <>
                            <span>Collapse</span>
                            <ChevronUp className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            <span>Expand</span>
                            <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    </div>
                    <div
                      className={`bg-secondary/30 p-2 rounded overflow-y-auto space-y-1 transition-all duration-200 ${
                        expandedSkippedMap[tx.transactionId] ? 'max-h-60' : 'max-h-24'
                      }`}
                    >
                      {skippedList.map((s: { path: string; reason: string }, idx: number) => (
                        <div key={idx} className="truncate font-mono text-[10.5px]">
                          • {maskPathPII(s?.reason || '')}
                        </div>
                      ))}
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
