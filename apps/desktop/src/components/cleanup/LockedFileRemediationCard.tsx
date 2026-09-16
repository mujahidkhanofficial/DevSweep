import React, { useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  SkipForward,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  ShieldAlert
} from 'lucide-react';
import { RemediationDiagnosis } from '@cleaner/shared';

interface LockedFileRemediationCardProps {
  diagnosis: RemediationDiagnosis;
  onRetry: () => void;
  onSkip: () => void;
  onRevealInExplorer?: (path: string) => void;
  isRetrying?: boolean;
}

export const LockedFileRemediationCard: React.FC<LockedFileRemediationCardProps> = ({
  diagnosis,
  onRetry,
  onSkip,
  onRevealInExplorer,
  isRetrying = false
}) => {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const count = diagnosis.failedCount;
  const fileWord = count === 1 ? 'file' : 'files';

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3.5 shadow-sm text-xs animate-in fade-in duration-150">
      {/* Header & Status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-foreground text-sm">
              {count} {fileWord} could not be removed
            </h4>
            <div className="text-muted-foreground whitespace-pre-line leading-relaxed">
              <span className="font-semibold text-amber-400 block mb-0.5">Possible cause:</span>
              <span>
                {diagnosis.likelyProcesses.length > 0
                  ? `${diagnosis.likelyProcesses.join(' / ')} may currently be using these ${fileWord}.`
                  : `A background application or Windows service may currently have a lock on these ${fileWord}.`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Advisory Notice */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border/60 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>
          <strong className="text-foreground font-medium">Advisory note:</strong> Close running instances of these applications or wait for background tasks to finish, then retry. DevSweep never forcibly terminates processes.
        </span>
      </div>

      {/* Action Buttons: [View Details] [Retry] [Skip] */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40">
        <button
          onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/80 hover:bg-secondary text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
        >
          {isDetailsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{isDetailsExpanded ? 'Hide Details' : 'View Details'}</span>
          <span className="text-[10px] text-muted-foreground ml-0.5">({count})</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={onSkip}
            disabled={isRetrying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground text-xs font-medium border border-border transition-colors cursor-pointer disabled:opacity-50"
            title="Acknowledge and leave remaining locked items untouched"
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span>Skip</span>
          </button>

          <button
            onClick={onRetry}
            disabled={isRetrying}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>{isRetrying ? 'Retrying...' : 'Retry'}</span>
          </button>
        </div>
      </div>

      {/* Expandable Details Panel */}
      {isDetailsExpanded && (
        <div className="space-y-2 pt-1">
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {diagnosis.items.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-lg bg-background/70 border border-border/70 space-y-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-foreground truncate max-w-[340px]" title={item.path}>
                    {item.fileName}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.errorCode && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        {item.errorCode}
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                        item.source === 'CANONICAL'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : item.source === 'HEURISTIC'
                          ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                          : 'bg-secondary text-muted-foreground border-border'
                      }`}
                      title={
                        item.source === 'CANONICAL'
                          ? 'Identified via verified developer toolchain metadata'
                          : item.source === 'HEURISTIC'
                          ? 'Inferred from directory path patterns'
                          : 'Unknown locking application'
                      }
                    >
                      {item.source === 'CANONICAL'
                        ? `Toolchain: ${item.suggestedProcess}`
                        : item.source === 'HEURISTIC'
                        ? `Suggested: ${item.suggestedProcess}`
                        : 'Unknown origin'}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground font-mono bg-secondary/40 px-2 py-1 rounded flex items-center justify-between gap-2 border border-border/40">
                  <span className="truncate" title={item.path}>
                    {item.path}
                  </span>
                  {onRevealInExplorer && (
                    <button
                      onClick={() => onRevealInExplorer(item.path)}
                      title="Reveal in Windows File Explorer"
                      className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer p-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>{item.advisoryNote}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
