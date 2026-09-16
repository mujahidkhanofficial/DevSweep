import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Plus,
  Trash2,
  Moon,
  Sun,
  Keyboard,
  Bell,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  Scissors
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore.js';

export const SettingsView: React.FC = () => {
  const {
    theme,
    toggleTheme,
    protectedPaths,
    loadProtectedPaths,
    addProtectedPath,
    removeProtectedPath,
    lowSpaceThresholdGB,
    setLowSpaceThreshold,
    historyRetention,
    loadHistoryRetention,
    saveHistoryRetention,
    pruneHistoryNow
  } = useSettingsStore();

  const [pruningNow, setPruningNow] = useState(false);
  const [pruneFeedback, setPruneFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [newPathInput, setNewPathInput] = useState('');
  const [validationStatus, setValidationStatus] = useState<{
    valid: boolean;
    exists: boolean;
    message: string;
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const validationReqId = React.useRef(0);

  useEffect(() => {
    loadProtectedPaths();
    loadHistoryRetention();
    return () => {
      // Invalidate any in-flight validation requests on component unmount
      validationReqId.current++;
    };
  }, []);

  useEffect(() => {
    const trimmed = newPathInput.trim();
    if (!trimmed) {
      validationReqId.current++;
      setValidationStatus(null);
      setIsValidating(false);
      return;
    }

    const currentReq = ++validationReqId.current;
    setIsValidating(true);
    const timer = setTimeout(async () => {
      if (window.cleaner?.validatePath) {
        try {
          const res = await window.cleaner.validatePath(trimmed);
          if (currentReq === validationReqId.current) {
            setValidationStatus(res);
            setIsValidating(false);
          }
        } catch {
          if (currentReq === validationReqId.current) {
            setValidationStatus({ valid: false, exists: false, message: 'Unable to validate path' });
            setIsValidating(false);
          }
        }
      } else {
        if (currentReq === validationReqId.current) {
          setIsValidating(false);
        }
      }
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [newPathInput]);

  const handleBrowseFolder = async () => {
    if (window.cleaner?.browseFolder) {
      const selected = await window.cleaner.browseFolder();
      if (selected) {
        validationReqId.current++;
        setNewPathInput(selected);
        setValidationStatus({ valid: true, exists: true, message: 'Valid existing directory' });
        setIsValidating(false);
      }
    }
  };

  const handleAddPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPathInput.trim()) return;
    await addProtectedPath(newPathInput.trim());
    setNewPathInput('');
    setValidationStatus(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Application Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure protection policies, drive thresholds, and interface preferences.
        </p>
      </div>

      {/* User Protected Locations */}
      <div className="p-5 bg-card rounded-xl border border-border space-y-4">
        <div className="flex items-center space-x-2 text-sm font-semibold text-foreground">
          <Shield className="w-4 h-4 text-safety-safe" />
          <span>User-Defined Protected Locations</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Directories placed here are strictly immuned from automatic cleanup. Source repositories, clients, and project roots are never cleaned.
        </p>

        {/* Add path form */}
        <form onSubmit={handleAddPath} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newPathInput}
              onChange={(e) => setNewPathInput(e.target.value)}
              placeholder="e.g. D:\Projects or C:\Dev"
              aria-label="Directory path to protect"
              className="flex-1 bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            />
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              title="Browse Windows directory"
            >
              <FolderOpen className="w-3.5 h-3.5 text-primary" />
              <span>Browse...</span>
            </button>
            <button
              type="submit"
              disabled={!newPathInput.trim() || (validationStatus !== null && !validationStatus.valid)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Path</span>
            </button>
          </div>

          {/* Inline Validation Status */}
          {newPathInput.trim() && (
            <div className="flex items-center space-x-1.5 text-[11px] px-1 animate-in fade-in duration-150">
              {isValidating ? (
                <>
                  <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                  <span className="text-muted-foreground">Validating path...</span>
                </>
              ) : validationStatus?.valid ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">{validationStatus.message}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-400 font-medium">{validationStatus?.message || 'Directory does not exist'}</span>
                </>
              )}
            </div>
          )}
        </form>

        {/* Path List */}
        <div className="space-y-2">
          {protectedPaths.length === 0 ? (
            <div className="p-4 rounded-lg bg-secondary/20 border border-border text-center text-xs text-muted-foreground">
              No custom protected directories added yet.
            </div>
          ) : (
            protectedPaths.map((p) => (
              <div key={p} className="p-2.5 rounded-lg bg-secondary/30 border border-border flex items-center justify-between text-xs">
                <span className="font-mono text-foreground truncate">{p}</span>
                <button
                  type="button"
                  onClick={() => removeProtectedPath(p)}
                  aria-label={`Remove ${p} from protected locations`}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden"
                  title={`Remove ${p} from protected locations`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Low Disk Threshold */}
      <div className="p-5 bg-card rounded-xl border border-border space-y-4">
        <div className="flex items-center space-x-2 text-sm font-semibold text-foreground">
          <Bell className="w-4 h-4 text-primary" />
          <span>Low Disk Space Alerts</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Trigger warning notification when system drive space falls below this threshold.
        </p>

        <div className="flex items-center space-x-4">
          <input
            type="range"
            min="5"
            max="100"
            step="5"
            value={lowSpaceThresholdGB}
            onChange={(e) => setLowSpaceThreshold(Number(e.target.value))}
            aria-label="Low disk space alert threshold in gigabytes"
            className="w-64 accent-primary rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          />
          <span className="text-xs font-bold text-foreground">{lowSpaceThresholdGB} GB</span>
        </div>
      </div>

      {/* Audit History Retention Policy */}
      <div className="p-5 bg-card rounded-xl border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm font-semibold text-foreground">
            <History className="w-4 h-4 text-primary" />
            <span>Audit History Retention Policy</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              setPruningNow(true);
              setPruneFeedback(null);
              try {
                const res = await pruneHistoryNow();
                if (res.success) {
                  setPruneFeedback({
                    type: 'success',
                    message:
                      res.prunedCount && res.prunedCount > 0
                        ? `Pruned ${res.prunedCount} record${res.prunedCount > 1 ? 's' : ''} according to current settings.`
                        : 'History already satisfies current retention settings. No records pruned.'
                  });
                } else {
                  setPruneFeedback({
                    type: 'error',
                    message: res.error || 'Could not prune history.'
                  });
                }
              } finally {
                setPruningNow(false);
              }
            }}
            disabled={pruningNow}
            className="px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 text-xs font-medium rounded-lg border border-border flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-hidden"
            title="Enforce configured retention policy now"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>{pruningNow ? 'Pruning...' : 'Prune History Now'}</span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Configure how long historical cleanup audit transactions are retained. Malformed or uninterpretable records are always preserved to guarantee zero accidental audit loss.
        </p>

        {pruneFeedback && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-200 ${
              pruneFeedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-destructive/10 border-destructive/20 text-destructive'
            }`}
          >
            <div className="flex items-center gap-2">
              {pruneFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
              )}
              <span>{pruneFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setPruneFeedback(null)}
              aria-label="Dismiss feedback message"
              className="text-[11px] underline hover:no-underline ml-4 cursor-pointer opacity-80 hover:opacity-100 rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          {/* Max Age */}
          <div className="space-y-1.5">
            <label htmlFor="time-based-retention" className="text-xs font-medium text-foreground block">
              Time-based Retention
            </label>
            <select
              id="time-based-retention"
              aria-label="Time-based audit retention policy"
              value={historyRetention.maxAgeDays}
              onChange={(e) =>
                saveHistoryRetention({
                  ...historyRetention,
                  maxAgeDays: Number(e.target.value)
                })
              }
              className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              <option value={30}>Keep for 30 days</option>
              <option value={60}>Keep for 60 days</option>
              <option value={90}>Keep for 90 days (Default)</option>
              <option value={180}>Keep for 180 days</option>
              <option value={365}>Keep for 1 year</option>
              <option value={0}>Keep indefinitely (Unlimited)</option>
            </select>
          </div>

          {/* Max Records */}
          <div className="space-y-1.5">
            <label htmlFor="max-records-retention" className="text-xs font-medium text-foreground block">
              Maximum Record Limit
            </label>
            <select
              id="max-records-retention"
              aria-label="Maximum audit record limit"
              value={historyRetention.maxRecords}
              onChange={(e) =>
                saveHistoryRetention({
                  ...historyRetention,
                  maxRecords: Number(e.target.value)
                })
              }
              className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              <option value={50}>Keep newest 50 records</option>
              <option value={100}>Keep newest 100 records (Default)</option>
              <option value={250}>Keep newest 250 records</option>
              <option value={500}>Keep newest 500 records</option>
              <option value={0}>No record limit (Unlimited)</option>
            </select>
          </div>
        </div>

        {/* Auto Prune on Save Toggle */}
        <div className="pt-2 border-t border-border/50 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-foreground block">
              Auto-prune when cleanup completes
            </span>
            <span className="text-[11px] text-muted-foreground block">
              Automatically enforces retention when saving newly completed cleanup transactions. Saving settings will never perform an immediate automatic purge.
            </span>
          </div>

          <input
            type="checkbox"
            checked={historyRetention.autoPruneOnSave}
            onChange={(e) =>
              saveHistoryRetention({
                ...historyRetention,
                autoPruneOnSave: e.target.checked
              })
            }
            aria-label="Auto-prune when cleanup completes"
            className="w-4 h-4 accent-primary rounded cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
          />
        </div>
      </div>

      {/* Appearance */}
      <div className="p-5 bg-card rounded-xl border border-border flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-foreground block">Appearance & Theme</span>
          <span className="text-xs text-muted-foreground">Toggle between clean dark mode and light mode</span>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-secondary text-foreground text-xs font-medium border border-border hover:bg-secondary/80 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
        >
          {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-amber-500" />}
          <span className="capitalize">{theme} Theme</span>
        </button>
      </div>

      {/* Keyboard Shortcuts Cheatsheet */}
      <div className="p-5 bg-card rounded-xl border border-border space-y-3">
        <div className="flex items-center space-x-2 text-sm font-semibold text-foreground">
          <Keyboard className="w-4 h-4 text-muted-foreground" />
          <span>Desktop Keyboard Shortcuts</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-secondary/30 flex justify-between items-center">
            <span className="text-muted-foreground">Switch Views (1-5)</span>
            <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono text-[10px]">Ctrl + 1..5</kbd>
          </div>
          <div className="p-2.5 rounded-lg bg-secondary/30 flex justify-between items-center">
            <span className="text-muted-foreground">Trigger Smart Scan</span>
            <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono text-[10px]">Ctrl + R</kbd>
          </div>
          <div className="p-2.5 rounded-lg bg-secondary/30 flex justify-between items-center">
            <span className="text-muted-foreground">Close Modal / Cancel / Clear</span>
            <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono text-[10px]">Esc</kbd>
          </div>
          <div className="p-2.5 rounded-lg bg-secondary/30 flex justify-between items-center">
            <span className="text-muted-foreground">Navigate Interactive Elements</span>
            <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono text-[10px]">Tab / Shift+Tab</kbd>
          </div>
        </div>
      </div>

      {/* About DevSweep */}
      <div className="p-5 bg-card rounded-xl border border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2.5">
              <img src="/icon.png" alt="DevSweep Logo" className="w-5 h-5 rounded-xs object-contain" />
              <span className="text-sm font-bold text-foreground">DevSweep</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">
                v1.0.0
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Developer-focused Windows disk cleanup & storage intelligence
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-secondary/20 border border-border text-[11px] text-muted-foreground space-y-1">
          <p className="text-foreground font-medium">Clean developer caches. Reclaim disk space. Stay in control.</p>
          <p>
            Engineered exclusively for developers with allowlist-first deletion, strict semantic path protection (.git, .env, SSH credentials), and resilient background worker execution.
          </p>
        </div>
      </div>
    </div>
  );
};
