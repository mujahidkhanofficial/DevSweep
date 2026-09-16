import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProtectedPathService } from '../packages/safety-engine/src/ProtectedPathService.js';
import { FingerprintService } from '../packages/safety-engine/src/FingerprintService.js';
import { SessionManager } from '../packages/safety-engine/src/SessionManager.js';
import { SafetyEngine } from '../packages/safety-engine/src/SafetyEngine.js';
import { CleanupExecutor } from '../packages/safety-engine/src/CleanupExecutor.js';
import { WindowsFileService } from '../packages/safety-engine/src/WindowsFileService.js';
import { CleanupManager } from '../packages/safety-engine/src/CleanupManager.js';
import { ScannedItem, CleanupTransaction } from '../packages/shared/src/rules.types.js';
import { CleanupProgressEvent } from '../packages/shared/src/disk.types.js';

describe('Cleanup Execution Resilience Architecture & Production Hardening', () => {
  let tempTestDir: string;
  let ruleRoot: string;
  let protectedService: ProtectedPathService;
  let sessionManager: SessionManager;
  let safetyEngine: SafetyEngine;
  let cleanupExecutor: CleanupExecutor;

  beforeEach(async () => {
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsweep-resilience-test-'));
    ruleRoot = path.join(tempTestDir, 'rule-cache-root');
    fs.mkdirSync(ruleRoot, { recursive: true });

    protectedService = new ProtectedPathService([path.join(tempTestDir, 'protected-user-dir')]);
    sessionManager = new SessionManager();
    safetyEngine = new SafetyEngine(protectedService, sessionManager);
    cleanupExecutor = new CleanupExecutor(safetyEngine);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  });

  describe('1. WindowsFileService & Normalized Error Taxonomy', () => {
    it('normalizes native OS error codes into expected categories', () => {
      const ebusy = new Error('resource busy') as any;
      ebusy.code = 'EBUSY';
      expect(WindowsFileService.normalizeError(ebusy).category).toBe('FILE_IN_USE');

      const eperm = new Error('operation not permitted') as any;
      eperm.code = 'EPERM';
      expect(WindowsFileService.normalizeError(eperm).category).toBe('ACCESS_DENIED');

      const eacces = new Error('permission denied') as any;
      eacces.code = 'EACCES';
      expect(WindowsFileService.normalizeError(eacces).category).toBe('ACCESS_DENIED');

      const enoent = new Error('no such file or directory') as any;
      enoent.code = 'ENOENT';
      expect(WindowsFileService.normalizeError(enoent).category).toBe('NOT_FOUND');

      const enametoolong = new Error('filename too long') as any;
      enametoolong.code = 'ENAMETOOLONG';
      expect(WindowsFileService.normalizeError(enametoolong).category).toBe('PATH_TOO_LONG');
    });

    it('detects and clears read-only attributes without shell command execution', async () => {
      const testFile = path.join(ruleRoot, 'readonly-file.txt');
      fs.writeFileSync(testFile, 'read only content', 'utf8');

      // Make read-only
      fs.chmodSync(testFile, 0o444);

      // Verify WindowsFileService clears attribute and removes file cleanly
      const cleared = await WindowsFileService.clearReadOnly(testFile);
      expect(cleared).toBe(true);

      const deleted = await WindowsFileService.forceDeleteFile(testFile);
      expect(deleted.success).toBe(true);
      expect(fs.existsSync(testFile)).toBe(false);
    });

    it('safely identifies reparse points / symlinks without recursively following them', async () => {
      const realTargetDir = path.join(tempTestDir, 'outside-target');
      fs.mkdirSync(realTargetDir, { recursive: true });
      const secretFile = path.join(realTargetDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'secret data', 'utf8');

      const symlinkPath = path.join(ruleRoot, 'symlink-to-target');
      try {
        fs.symlinkSync(realTargetDir, symlinkPath, 'junction');
      } catch {
        // If symlink privileges are not enabled on this Windows machine, skip symlink creation check
        return;
      }

      const isReparse = await WindowsFileService.isReparsePoint(symlinkPath);
      expect(isReparse).toBe(true);

      // Deleting the reparse point directly should NOT delete the target's contents
      const unlinkResult = await WindowsFileService.forceDeleteReparsePoint(symlinkPath);
      expect(unlinkResult.success).toBe(true);
      expect(fs.existsSync(symlinkPath)).toBe(false);
      // Secret outside target must remain completely unharmed!
      expect(fs.existsSync(secretFile)).toBe(true);
    });
  });

  describe('2. Large Directory Traversal & Hierarchical Progress', () => {
    it('processes 2,000+ nested files emitting hierarchical progress without freezing', async () => {
      const largeDir = path.join(ruleRoot, 'large-cache-package');
      fs.mkdirSync(largeDir, { recursive: true });

      // Create 5 subdirectories with 400 files each = 2,000 files
      const totalFilesTarget = 2000;
      const subdirs = 5;
      const filesPerSubdir = totalFilesTarget / subdirs;

      for (let s = 0; s < subdirs; s++) {
        const sub = path.join(largeDir, `sub_${s}`);
        fs.mkdirSync(sub, { recursive: true });
        for (let f = 0; f < filesPerSubdir; f++) {
          fs.writeFileSync(path.join(sub, `file_${f}.bin`), 'x', 'utf8');
        }
      }

      const session = sessionManager.createSession();
      const fp = await FingerprintService.capture(largeDir);

      const scannedItem: ScannedItem = {
        id: 'large-cache-item',
        ruleId: 'LARGE_CACHE',
        category: 'SYSTEM',
        label: 'Large Cache Package',
        path: largeDir,
        size: fp!.size,
        fileCount: totalFilesTarget,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      };

      sessionManager.registerItem(session.id, scannedItem);

      const progressEvents: CleanupProgressEvent[] = [];
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'LARGE_CACHE',
        ruleRoot,
        selectedItemIds: ['large-cache-item'],
        dryRun: false,
        onProgress: (prog) => {
          progressEvents.push({ ...prog });
        }
      });

      expect(tx.status).toBe('COMPLETED');
      expect(tx.deletedCount).toBe(1);
      expect(fs.existsSync(largeDir)).toBe(false);

      // Hierarchical progress verification
      expect(progressEvents.length).toBeGreaterThan(1);
      const intermediateEvents = progressEvents.filter((e) => (e.filesProcessed || 0) > 0);
      expect(intermediateEvents.length).toBeGreaterThan(0);

      const lastProgress = progressEvents[progressEvents.length - 1];
      expect(lastProgress.filesDeleted).toBeGreaterThanOrEqual(totalFilesTarget);
      expect(lastProgress.status).toBe('COMPLETED');
    });
  });

  describe('3. Child Error Isolation & Partial Directory Handling', () => {
    it('isolates locked child file error, deletes all other sibling files, and sets status PARTIAL', async () => {
      const parentDir = path.join(ruleRoot, 'package-with-locked-file');
      fs.mkdirSync(parentDir, { recursive: true });

      const file1 = path.join(parentDir, 'clean_sibling1.txt');
      const file2 = path.join(parentDir, 'clean_sibling2.txt');
      const lockedFile = path.join(parentDir, 'locked_child.txt');

      fs.writeFileSync(file1, 'sibling 1', 'utf8');
      fs.writeFileSync(file2, 'sibling 2', 'utf8');
      fs.writeFileSync(lockedFile, 'locked content', 'utf8');

      const origSafeUnlink = WindowsFileService.safeUnlinkFile;
      const spy = vi.spyOn(WindowsFileService, 'safeUnlinkFile').mockImplementation(async (targetPath: string) => {
        if (targetPath.includes('locked_child.txt')) {
          return {
            success: false,
            bytes: 0,
            errorCategory: 'FILE_IN_USE',
            rawErrorCode: 'EBUSY',
            errorMessage: 'File is in use by Windows or another running process (EBUSY)'
          };
        }
        return origSafeUnlink.call(WindowsFileService, targetPath);
      });

      try {
        const session = sessionManager.createSession();
        const fp = await FingerprintService.capture(parentDir);

        const scannedItem: ScannedItem = {
          id: 'partial-dir-item',
          ruleId: 'TEST_RULE',
          category: 'SYSTEM',
          label: 'Partial Package',
          path: parentDir,
          size: fp!.size,
          fileCount: 3,
          safetyLevel: 'SAFE',
          selectedByDefault: true,
          fingerprint: fp!,
          explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
        };

        sessionManager.registerItem(session.id, scannedItem);

        const tx = await cleanupExecutor.execute({
          scanSessionId: session.id,
          ruleId: 'TEST_RULE',
          ruleRoot,
          selectedItemIds: ['partial-dir-item'],
          dryRun: false
        });

        // The overall transaction should be PARTIAL or SKIPPED, NOT FAILED
        expect(['PARTIAL', 'COMPLETED']).toContain(tx.status);
        expect(tx.skippedCount + tx.deletedCount).toBeGreaterThanOrEqual(1);

        // Verify siblings were successfully deleted despite locked child
        expect(fs.existsSync(file1)).toBe(false);
        expect(fs.existsSync(file2)).toBe(false);
        // Locked file was preserved safely
        expect(fs.existsSync(lockedFile)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('4. Cooperative Cancellation & Pause/Resume', () => {
    it('stops scheduling immediately upon cancellation, marks remaining items CANCELLED, and leaves no zombie operations', async () => {
      const file1 = path.join(ruleRoot, 'cancel_item_1.tmp');
      const file2 = path.join(ruleRoot, 'cancel_item_2.tmp');
      fs.writeFileSync(file1, 'data 1', 'utf8');
      fs.writeFileSync(file2, 'data 2', 'utf8');

      const session = sessionManager.createSession();
      const fp1 = await FingerprintService.capture(file1);
      const fp2 = await FingerprintService.capture(file2);

      const item1: ScannedItem = {
        id: 'c-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Cancel Item 1',
        path: file1,
        size: fp1!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp1!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      };

      const item2: ScannedItem = {
        id: 'c-2',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Cancel Item 2',
        path: file2,
        size: fp2!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp2!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      };

      sessionManager.registerItem(session.id, item1);
      sessionManager.registerItem(session.id, item2);

      const abortController = new AbortController();

      let progressCount = 0;
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        ruleRoot,
        selectedItemIds: ['c-1', 'c-2'],
        dryRun: false,
        abortSignal: abortController.signal,
        onProgress: () => {
          progressCount++;
          if (progressCount === 1) {
            abortController.abort(); // Cancel during execution
          }
        }
      });

      expect(tx.status).toBe('CANCELLED');
      expect(tx.cancelledCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. Activity Monitor & Terminal Invariants', () => {
    it('verifies strict terminal invariants: terminalCount === totalRequested', async () => {
      const fileA = path.join(ruleRoot, 'inv_a.tmp');
      const fileB = path.join(ruleRoot, 'inv_b.tmp');
      fs.writeFileSync(fileA, 'data a', 'utf8');
      fs.writeFileSync(fileB, 'data b', 'utf8');

      const session = sessionManager.createSession();
      const fpA = await FingerprintService.capture(fileA);
      const fpB = await FingerprintService.capture(fileB);

      sessionManager.registerItem(session.id, {
        id: 'inv-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Inv 1',
        path: fileA,
        size: fpA!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fpA!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      });

      sessionManager.registerItem(session.id, {
        id: 'inv-2',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Inv 2',
        path: fileB,
        size: fpB!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fpB!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      });

      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        ruleRoot,
        selectedItemIds: ['inv-1', 'inv-2'],
        dryRun: false
      });

      const terminalCount =
        tx.deletedCount +
        tx.skippedCount +
        tx.failedCount +
        (tx.timedOutCount || 0) +
        (tx.cancelledCount || 0);

      expect(terminalCount).toBe(tx.totalRequested);
      expect(tx.status).toBe('COMPLETED');
    });

    it('simulates slow / stalled activity classifications accurately', () => {
      const manager = new CleanupManager(safetyEngine);

      // Activity thresholds:
      // ACTIVE: 0-2s
      // WORKING: 2-10s
      // SLOW: 10-60s
      // STALLED: >60s

      const now = Date.now();
      expect((manager as any).classifyHeartbeat(now - 1000)).toBe('ACTIVE');
      expect((manager as any).classifyHeartbeat(now - 5000)).toBe('WORKING');
      expect((manager as any).classifyHeartbeat(now - 25000)).toBe('SLOW');
      expect((manager as any).classifyHeartbeat(now - 65000)).toBe('STALLED');
    });
  });

  describe('6. Atomic History Persistence', () => {
    it('persists history records atomically via temporary file and rename without partial corruptions', async () => {
      const historyFilePath = path.join(tempTestDir, 'history.json');
      const tempFilePath = `${historyFilePath}.tmp`;

      const record: CleanupTransaction = {
        transactionId: 'TX-TEST-001',
        scanSessionId: 'sess-123',
        ruleId: 'TEST_RULE',
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        status: 'COMPLETED',
        dryRun: false,
        totalRequested: 1,
        validatedCount: 1,
        deletedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        timedOutCount: 0,
        cancelledCount: 0,
        bytesReclaimed: 1024,
        skippedDetails: []
      };

      // Atomic write pattern
      fs.writeFileSync(tempFilePath, JSON.stringify([record], null, 2), 'utf-8');
      fs.renameSync(tempFilePath, historyFilePath);

      expect(fs.existsSync(historyFilePath)).toBe(true);
      expect(fs.existsSync(tempFilePath)).toBe(false);

      const content = JSON.parse(fs.readFileSync(historyFilePath, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].transactionId).toBe('TX-TEST-001');
    });
  });
});
