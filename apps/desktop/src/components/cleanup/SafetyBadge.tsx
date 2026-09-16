import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Shield, ShieldX } from 'lucide-react';
import { SafetyLevel, getSafetyExplanation } from '@cleaner/shared';

interface SafetyBadgeProps {
  level: SafetyLevel;
}

export const SafetyBadge: React.FC<SafetyBadgeProps> = ({ level }) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const explanation = getSafetyExplanation(level);

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

  const getBadgeStyle = () => {
    switch (level) {
      case 'SAFE':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20';
      case 'REBUILDABLE':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/20';
      case 'REVIEW':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/25 hover:bg-rose-500/20';
      case 'PROTECTED':
        return 'bg-secondary text-muted-foreground border-border hover:bg-secondary/80';
      default:
        return 'bg-secondary text-muted-foreground border-border';
    }
  };

  const getBadgeIcon = () => {
    switch (level) {
      case 'SAFE':
        return <ShieldCheck className="w-2.5 h-2.5 shrink-0" />;
      case 'REBUILDABLE':
        return <Shield className="w-2.5 h-2.5 shrink-0" />;
      case 'REVIEW':
        return <ShieldAlert className="w-2.5 h-2.5 shrink-0" />;
      case 'PROTECTED':
        return <ShieldX className="w-2.5 h-2.5 shrink-0" />;
    }
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Safety level: ${explanation.label}. Click or press Enter for classification details.`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase border transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary ${getBadgeStyle()}`}
      >
        {getBadgeIcon()}
        <span>{explanation.label}</span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${explanation.label} safety classification details`}
          className="absolute left-0 top-full mt-1.5 z-40 w-72 p-3 rounded-xl bg-card border border-border shadow-xl space-y-2 text-xs animate-in fade-in duration-100"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border ${getBadgeStyle()}`}>
                {explanation.label}
              </span>
              <span className="font-bold text-foreground text-xs">Safety Classification</span>
            </div>
          </div>

          <div className="space-y-1 text-[11px] leading-relaxed">
            <p className="font-semibold text-foreground">
              {explanation.shortDescription}
            </p>
            <p className="text-muted-foreground">
              {explanation.detailedDescription}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
