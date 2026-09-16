import React, { useState, useRef, useEffect } from 'react';
import { Layers, Terminal, ExternalLink } from 'lucide-react';
import { ToolchainId, getToolchainAttribution } from '@cleaner/shared';

interface ToolchainBadgeProps {
  toolchainId?: ToolchainId;
  relatedToolchains?: ToolchainId[];
}

export const ToolchainBadge: React.FC<ToolchainBadgeProps> = ({
  toolchainId,
  relatedToolchains
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const attribution = getToolchainAttribution(toolchainId, relatedToolchains);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!attribution) return null;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Toolchain: ${attribution.primary.displayName}. Click or press Enter for attribution details.`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <Terminal className="w-2.5 h-2.5 shrink-0" />
        <span>{attribution.primary.displayName}</span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${attribution.primary.displayName} toolchain attribution`}
          className="absolute left-0 top-full mt-1.5 z-40 w-76 p-3 rounded-xl bg-card border border-border shadow-xl space-y-2.5 text-xs animate-in fade-in duration-100"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-foreground text-xs">{attribution.primary.displayName}</span>
              <span className="text-[10px] text-muted-foreground">({attribution.primary.ecosystem})</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-secondary text-primary border border-border">
              Toolchain
            </span>
          </div>

          <div className="space-y-1.5 text-[11px] leading-relaxed">
            <div>
              <span className="font-semibold text-foreground block mb-0.5">Why this belongs here:</span>
              <p className="text-muted-foreground">{attribution.primary.whyBelongs}</p>
            </div>

            {attribution.related.length > 0 && (
              <div className="pt-1.5 border-t border-border/40">
                <span className="font-semibold text-foreground block mb-0.5">Also related to:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {attribution.related.map((rel) => (
                    <span
                      key={rel.id}
                      className="px-1.5 py-0.2 rounded text-[10px] bg-secondary/80 text-foreground border border-border/70"
                      title={rel.whyBelongs}
                    >
                      {rel.displayName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
