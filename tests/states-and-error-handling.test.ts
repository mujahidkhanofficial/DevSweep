import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizeError } from '../apps/desktop/src/lib/errorUtils.js';
import { useScanStore } from '../apps/desktop/src/stores/useScanStore.js';
import { useDiskStore } from '../apps/desktop/src/stores/useDiskStore.js';
import { useHistoryStore } from '../apps/desktop/src/stores/useHistoryStore.js';

describe('Priority 4.7 — Loading, Empty & Error State Polish Suite', () => {
  const rootDir = path.resolve(__dirname, '..');
  const desktopSrcDir = path.join(rootDir, 'apps/desktop/src');

  // --------------------------------------------------------------------------
  // 1. Renderer Alert/Confirm Audit
  // --------------------------------------------------------------------------
  describe('Zero Native Blocking Dialogs Audit', () => {
    function getAllFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getAllFiles(fullPath));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    it('verifies ZERO window.alert() and ZERO window.confirm() calls in apps/desktop/src', () => {
      const files = getAllFiles(desktopSrcDir);
      const alertRegex = /\b(alert|confirm)\s*\(/;

      const violations: { file: string; match: string }[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const match = content.match(alertRegex);
        if (match) {
          violations.push({
            file: path.relative(rootDir, file),
            match: match[0]
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Centralized Error Normalization (normalizeError)
  // --------------------------------------------------------------------------
  describe('Error Normalization Boundary (normalizeError)', () => {
    it('returns fallback message for empty, null, or undefined errors', () => {
      expect(normalizeError(null)).toBe('An unexpected error occurred.');
      expect(normalizeError(undefined)).toBe('An unexpected error occurred.');
      expect(normalizeError('')).toBe('An unexpected error occurred.');
    });

    it('strips Electron IPC boilerplate from remote method invocation errors', () => {
      const ipcError = "Error invoking remote method 'cleaner:start-scan': Error: Operation failed";
      const normalized = normalizeError(ipcError);
      expect(normalized).toBe('Operation failed');
    });

    it('strips leading "Error: " prefix', () => {
      expect(normalizeError('Error: Access is denied')).toBe('Access is denied');
      expect(normalizeError(new Error('Drive not ready'))).toBe('Drive not ready');
    });

    it('strips multi-line stack traces to keep messages clean and single-line', () => {
      const errorWithStack = new Error('Disk query failed');
      errorWithStack.stack = 'Error: Disk query failed\n    at queryDrives (drives.ts:42:10)\n    at async run';
      const normalized = normalizeError(errorWithStack);
      expect(normalized).toBe('Disk query failed');
      expect(normalized).not.toContain('\n');
      expect(normalized).not.toContain('queryDrives');
    });

    it('redacts sensitive Windows user profile paths (C:\\Users\\<username>\\...)', () => {
      const rawError = 'Failed to remove C:\\Users\\Administrator\\AppData\\Local\\Temp\\cache.dat';
      const normalized = normalizeError(rawError);
      expect(normalized).toContain('C:\\Users\\***\\AppData\\Local\\Temp\\cache.dat');
      expect(normalized).not.toContain('Administrator');
    });

    it('redacts sensitive Linux/macOS user profile paths (/home/<username>/...)', () => {
      const rawError = 'Cannot access /home/developer/.cache/cargo/registry';
      const normalized = normalizeError(rawError);
      expect(normalized).toContain('/home/***/.cache/cargo/registry');
      expect(normalized).not.toContain('developer');
    });

    it('translates EBUSY to actionable file lock guidance', () => {
      const ebusy = 'EBUSY: resource locked or busy, unlink "node_modules/.bin"';
      expect(normalizeError(ebusy)).toBe(
        'The target file is currently locked or in use by another running program (EBUSY).'
      );
    });

    it('translates EPERM and EACCES to actionable permission guidance', () => {
      const eperm = 'EPERM: operation not permitted, unlink "protected.dll"';
      const eacces = 'EACCES: permission denied, open "system.log"';
      const expected = 'Permission denied. DevSweep lacks elevated permissions to modify this path (EPERM/EACCES).';
      expect(normalizeError(eperm)).toBe(expected);
      expect(normalizeError(eacces)).toBe(expected);
    });

    it('translates ENOENT to clear missing path guidance', () => {
      const enoent = 'ENOENT: no such file or directory, stat "temp/old.log"';
      expect(normalizeError(enoent)).toBe(
        'The target path no longer exists or was moved (ENOENT).'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Scan Store Lifecycle and Stale Decoupling
  // --------------------------------------------------------------------------
  describe('Scan Store Lifecycle & State Invariants', () => {
    beforeEach(() => {
      // Reset window.cleaner mock
      (globalThis as any).window = {};
      useScanStore.setState({
        scanStatus: 'IDLE',
        scanSessionId: null,
        scannedCandidateCount: null,
        currentSessionReclaimed: false,
        error: null,
        isScanning: false,
        isPaused: false,
        isCancelled: false,
        progress: null,
        items: [],
        selectedItemIds: new Set<string>()
      });
    });

    it('initializes with IDLE status and zero errors', () => {
      const state = useScanStore.getState();
      expect(state.scanStatus).toBe('IDLE');
      expect(state.error).toBeNull();
      expect(state.scannedCandidateCount).toBeNull();
      expect(state.currentSessionReclaimed).toBe(false);
    });

    it('transitions to FAILED with normalized error when desktop bridge is missing', async () => {
      delete (globalThis as any).window.cleaner;
      await useScanStore.getState().startScan();

      const state = useScanStore.getState();
      expect(state.scanStatus).toBe('FAILED');
      expect(state.isScanning).toBe(false);
      expect(state.error).toBe('System cleaner bridge is not available.');
    });

    it('sets COMPLETED status and records candidate count when scan returns items', async () => {
      (globalThis as any).window.cleaner = {
        onScanProgress: () => () => {},
        startScan: vi.fn().mockResolvedValue({
          scanSessionId: 'sess-123',
          isCancelled: false,
          items: [
            { id: '1', name: 'Item 1', size: 100, selectedByDefault: true, safetyLevel: 'SAFE' },
            { id: '2', name: 'Item 2', size: 200, selectedByDefault: false, safetyLevel: 'SAFE' }
          ]
        })
      };

      await useScanStore.getState().startScan();

      const state = useScanStore.getState();
      expect(state.scanStatus).toBe('COMPLETED');
      expect(state.scanSessionId).toBe('sess-123');
      expect(state.scannedCandidateCount).toBe(2);
      expect(state.currentSessionReclaimed).toBe(false);
      expect(state.items.length).toBe(2);
      expect(state.selectedItemIds.has('1')).toBe(true);
      expect(state.selectedItemIds.has('2')).toBe(false);
    });

    it('sets COMPLETED status with 0 candidates for pristine scan', async () => {
      (globalThis as any).window.cleaner = {
        onScanProgress: () => () => {},
        startScan: vi.fn().mockResolvedValue({
          scanSessionId: 'sess-456',
          isCancelled: false,
          items: []
        })
      };

      await useScanStore.getState().startScan();

      const state = useScanStore.getState();
      expect(state.scanStatus).toBe('COMPLETED');
      expect(state.scannedCandidateCount).toBe(0);
      expect(state.currentSessionReclaimed).toBe(false);
      expect(state.items.length).toBe(0);
    });

    it('decouples currentSessionReclaimed: ONLY true when candidates were cleaned, NOT on pristine scan', () => {
      // Scenario A: Pristine scan (0 candidates scanned)
      useScanStore.setState({
        scanStatus: 'COMPLETED',
        scannedCandidateCount: 0,
        items: [],
        currentSessionReclaimed: false
      });

      useScanStore.getState().removeItemsAfterCleanup([]);
      expect(useScanStore.getState().currentSessionReclaimed).toBe(false);

      // Scenario B: Candidates were found and subsequently deleted
      useScanStore.setState({
        scanStatus: 'COMPLETED',
        scannedCandidateCount: 3,
        items: [{ id: 'a' } as any, { id: 'b' } as any],
        selectedItemIds: new Set(['a', 'b'])
      });

      useScanStore.getState().removeItemsAfterCleanup(['a', 'b']);
      expect(useScanStore.getState().items.length).toBe(0);
      expect(useScanStore.getState().currentSessionReclaimed).toBe(true);
    });

    it('transitions to CANCELLED on cancelScan', async () => {
      (globalThis as any).window.cleaner = {
        cancelScan: vi.fn().mockResolvedValue(true)
      };
      useScanStore.setState({ scanSessionId: 'sess-cancel', scanStatus: 'SCANNING', isScanning: true });

      await useScanStore.getState().cancelScan();

      const state = useScanStore.getState();
      expect(state.scanStatus).toBe('CANCELLED');
      expect(state.isCancelled).toBe(true);
      expect(state.isScanning).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Disk and History Store Error Normalization
  // --------------------------------------------------------------------------
  describe('Disk & History Store Error Handling', () => {
    it('normalizes errors in useDiskStore.fetchSystemInfo', async () => {
      (globalThis as any).window.cleaner = {
        getDrives: vi.fn().mockRejectedValue(new Error('EPERM: cannot read physical drive')),
        getEnvironments: vi.fn().mockResolvedValue([])
      };

      await useDiskStore.getState().fetchSystemInfo();
      const state = useDiskStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toContain('Permission denied. DevSweep lacks elevated permissions');
    });

    it('normalizes errors in useHistoryStore.loadHistory', async () => {
      (globalThis as any).window.cleaner = {
        getHistory: vi.fn().mockRejectedValue(new Error('EBUSY: history.json locked'))
      };

      await useHistoryStore.getState().loadHistory();
      const state = useHistoryStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toContain('The target file is currently locked or in use');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Accessible Roles and Skeletons Code Inspection
  // --------------------------------------------------------------------------
  describe('Accessibility Roles, Skeletons, and Prefers-Reduced-Motion Inspection', () => {
    it('verifies role="alert" is used for errors across views', () => {
      const views = [
        'apps/desktop/src/components/dashboard/DashboardView.tsx',
        'apps/desktop/src/components/cleanup/CleanupView.tsx',
        'apps/desktop/src/components/history/HistoryView.tsx',
        'apps/desktop/src/components/scan/ScanModal.tsx'
      ];

      for (const view of views) {
        const content = fs.readFileSync(path.join(rootDir, view), 'utf8');
        expect(content).toContain('role="alert"');
      }
    });

    it('verifies skeleton loading containers define aria-busy="true"', () => {
      const viewsWithSkeletons = [
        'apps/desktop/src/components/dashboard/DashboardView.tsx',
        'apps/desktop/src/components/storage/StorageView.tsx',
        'apps/desktop/src/components/history/HistoryView.tsx'
      ];

      for (const view of viewsWithSkeletons) {
        const content = fs.readFileSync(path.join(rootDir, view), 'utf8');
        expect(content).toContain('aria-busy="true"');
      }
    });

    it('verifies index.css includes prefers-reduced-motion media query', () => {
      const cssPath = path.join(rootDir, 'apps/desktop/src/styles/index.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).toContain('animation-duration: 0.01ms');
    });

    it('verifies ScanModal and CleanupView wire "Retry Scan" to useScanStore.startScan', () => {
      const scanModalPath = path.join(rootDir, 'apps/desktop/src/components/scan/ScanModal.tsx');
      const scanModal = fs.readFileSync(scanModalPath, 'utf8');
      expect(scanModal).toContain('startScan()');

      const cleanupViewPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const cleanupView = fs.readFileSync(cleanupViewPath, 'utf8');
      expect(cleanupView).toContain('startScan()');
    });

    it('verifies StorageView separates NO_DATA, LOADING, THRESHOLD_EMPTY, and SEARCH_EMPTY states', () => {
      const storageViewPath = path.join(rootDir, 'apps/desktop/src/components/storage/StorageView.tsx');
      const content = fs.readFileSync(storageViewPath, 'utf8');

      expect(content).toContain('No oversized files detected');
      expect(content).toContain('aria-busy="true"');
      expect(content).toContain('No files exceed');
      expect(content).toContain('No search results');
    });

    it('verifies CleanupView empty state distinguishes RECLAIMED vs PRISTINE vs FAILED vs CANCELLED', () => {
      const cleanupViewPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const content = fs.readFileSync(cleanupViewPath, 'utf8');

      expect(content).toContain('scanStatus === \'FAILED\'');
      expect(content).toContain('scanStatus === \'CANCELLED\'');
      expect(content).toContain('currentSessionReclaimed');
      expect(content).toContain('All Selected Caches Reclaimed');
      expect(content).toContain('System Caches are Clean & Pristine');
      expect(content).toContain('No Active Scan Candidates');
    });
  });
});
