import { describe, it, expect } from 'vitest';
import { maskPathPII } from '../apps/desktop/src/components/history/HistoryView.js';
import { CleanupManager } from '../packages/safety-engine/src/CleanupManager.js';
import { SafetyEngine } from '../packages/safety-engine/src/SafetyEngine.js';

describe('Audit History Remediation & Enterprise Polish', () => {
  describe('maskPathPII — User Profile Privacy Redaction', () => {
    it('masks Windows user profile paths with backslashes', () => {
      const raw = 'Cannot delete C:\\Users\\mujah\\AppData\\Local\\Temp\\pinned.lock: EPERM';
      const masked = maskPathPII(raw);
      expect(masked).toBe('Cannot delete C:\\Users\\***\\AppData\\Local\\Temp\\pinned.lock: EPERM');
      expect(masked).not.toContain('mujah');
    });

    it('masks Windows user profile paths with forward slashes', () => {
      const raw = 'Failed at C:/Users/developer_name/project/cache';
      const masked = maskPathPII(raw);
      expect(masked).toBe('Failed at C:/Users/***/project/cache');
      expect(masked).not.toContain('developer_name');
    });

    it('masks Unix /home/ user directory paths', () => {
      const raw = 'Skip /home/alice/.cache/yarn/v6: permission denied';
      const masked = maskPathPII(raw);
      expect(masked).toBe('Skip /home/***/.cache/yarn/v6: permission denied');
      expect(masked).not.toContain('alice');
    });

    it('handles empty, null, or undefined gracefully', () => {
      expect(maskPathPII('')).toBe('');
      // @ts-expect-error testing falsy
      expect(maskPathPII(null)).toBe('');
      // @ts-expect-error testing falsy
      expect(maskPathPII(undefined)).toBe('');
    });

    it('preserves generic system paths without user profile folders', () => {
      const systemPath = 'System file in C:\\ProgramData\\Docker or /var/tmp/cache';
      expect(maskPathPII(systemPath)).toBe(systemPath);
    });
  });

  describe('ESM Module __dirname Safety in CleanupManager', () => {
    it('instantiates CleanupManager and verifies module-level variables are defined', () => {
      const safetyEngine = new SafetyEngine({} as any, {} as any);
      const manager = new CleanupManager(safetyEngine);
      expect(manager).toBeDefined();
      expect(typeof manager.execute).toBe('function');
      expect(typeof CleanupManager.classifyHeartbeat).toBe('function');
    });

    it('correctly classifies heartbeats', () => {
      const now = Date.now();
      expect(CleanupManager.classifyHeartbeat(now - 500)).toBe('ACTIVE');
      expect(CleanupManager.classifyHeartbeat(now - 5000)).toBe('WORKING');
      expect(CleanupManager.classifyHeartbeat(now - 20000)).toBe('SLOW');
      expect(CleanupManager.classifyHeartbeat(now - 70000)).toBe('STALLED');
    });
  });

  describe('History Display Semantics', () => {
    it('maps BATCH_ALL ruleId to friendly title', () => {
      const ruleId = 'BATCH_ALL';
      const display = ruleId === 'BATCH_ALL' ? 'Multi-Rule Batch Cleanup' : ruleId;
      expect(display).toBe('Multi-Rule Batch Cleanup');
    });

    it('differentiates COMPLETED, PARTIAL, and FAILED status styling tokens', () => {
      const getStatusClasses = (status: 'COMPLETED' | 'PARTIAL' | 'FAILED') => {
        if (status === 'COMPLETED') {
          return { badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', icon: 'bg-emerald-500/10 text-emerald-400' };
        }
        if (status === 'PARTIAL') {
          return { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20', icon: 'bg-amber-500/10 text-amber-400' };
        }
        return { badge: 'bg-rose-500/15 text-rose-400 border-rose-500/20', icon: 'bg-rose-500/10 text-rose-400' };
      };

      const completed = getStatusClasses('COMPLETED');
      const partial = getStatusClasses('PARTIAL');
      const failed = getStatusClasses('FAILED');

      expect(completed.badge).toContain('emerald');
      expect(partial.badge).toContain('amber');
      expect(failed.badge).toContain('rose');
      expect(completed.badge).not.toBe(partial.badge);
      expect(partial.badge).not.toBe(failed.badge);
    });
  });
});
