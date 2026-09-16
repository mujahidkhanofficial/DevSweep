import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProtectedPathService } from '../packages/safety-engine/src/ProtectedPathService.js';
import { FingerprintService } from '../packages/safety-engine/src/FingerprintService.js';
import { SessionManager } from '../packages/safety-engine/src/SessionManager.js';
import { SafetyEngine } from '../packages/safety-engine/src/SafetyEngine.js';
import { CleanupExecutor } from '../packages/safety-engine/src/CleanupExecutor.js';
import { ScannedItem } from '../packages/shared/src/rules.types.js';

describe('Phase 0 Safety Engine & Invariants Testbed', () => {
  let tempTestDir: string;
  let ruleRoot: string;
  let protectedService: ProtectedPathService;
  let sessionManager: SessionManager;
  let safetyEngine: SafetyEngine;
  let cleanupExecutor: CleanupExecutor;

  beforeEach(async () => {
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsweep-safety-test-'));
    ruleRoot = path.join(tempTestDir, 'rule-cache-root');
    fs.mkdirSync(ruleRoot, { recursive: true });

    protectedService = new ProtectedPathService([path.join(tempTestDir, 'user-protected-repo')]);
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

  describe('1. Semantic Path & Secret Protection', () => {
    it('protects .git directories semantically without false positives on filenames like my.git.backup', () => {
      // True .git directory segment
      const gitPath = path.join(ruleRoot, 'project', '.git', 'config');
      const gitCheck = protectedService.checkPath(gitPath, ruleRoot);
      expect(gitCheck.isProtected).toBe(true);
      expect(gitCheck.reason).toContain('sensitive semantic directory segment: ".git"');

      // False positive check: directory named my.git.backup should not be classified as git
      const backupPath = path.join(ruleRoot, 'my.git.backup', 'data.txt');
      const backupCheck = protectedService.checkPath(backupPath, ruleRoot);
      expect(backupCheck.isProtected).toBe(false);
    });

    it('protects credential and secret files (.env, keys, keystores)', () => {
      const envPath = path.join(ruleRoot, '.env');
      expect(protectedService.checkPath(envPath, ruleRoot).isProtected).toBe(true);

      const envLocalPath = path.join(ruleRoot, '.env.local');
      expect(protectedService.checkPath(envLocalPath, ruleRoot).isProtected).toBe(true);

      const sshKeyPath = path.join(ruleRoot, 'id_rsa');
      expect(protectedService.checkPath(sshKeyPath, ruleRoot).isProtected).toBe(true);

      const keystorePath = path.join(ruleRoot, 'release.keystore');
      expect(protectedService.checkPath(keystorePath, ruleRoot).isProtected).toBe(true);

      const normalLog = path.join(ruleRoot, 'output.log');
      expect(protectedService.checkPath(normalLog, ruleRoot).isProtected).toBe(false);
    });

    it('enforces User Protected locations', () => {
      const userRepo = path.join(tempTestDir, 'user-protected-repo', 'file.txt');
      const check = protectedService.checkPath(userRepo);
      expect(check.isProtected).toBe(true);
      expect(check.tier).toBe('USER_PROTECTED');
    });

    it('strictly prevents path traversal outside rule boundaries', () => {
      const escapedPath = path.join(ruleRoot, '..', 'external-file.txt');
      const check = protectedService.checkPath(escapedPath, ruleRoot);
      expect(check.isProtected).toBe(true);
      expect(check.tier).toBe('RULE_PROTECTED');
    });
  });

  describe('2. Reparse Point / Junction / Symlink Invariant', () => {
    it('unlinks symlink without descending or touching target destination files', async () => {
      // 1. Create external protected target directory with important file
      const externalTargetDir = path.join(tempTestDir, 'external-important-target');
      fs.mkdirSync(externalTargetDir, { recursive: true });
      const importantFile = path.join(externalTargetDir, 'do_not_delete.txt');
      fs.writeFileSync(importantFile, 'CRITICAL USER DATA', 'utf8');

      // 2. Create a symlink or junction inside ruleRoot pointing to externalTargetDir
      const linkInsideRule = path.join(ruleRoot, 'junction_to_external');
      try {
        fs.symlinkSync(externalTargetDir, linkInsideRule, 'junction');
      } catch {
        // Fallback for non-elevated symlink on Windows if needed
        fs.symlinkSync(externalTargetDir, linkInsideRule, 'dir');
      }

      // 3. Register link inside a scan session
      const session = sessionManager.createSession();
      const fp = await FingerprintService.capture(linkInsideRule);
      expect(fp).not.toBeNull();
      expect(fp!.isSymbolicLink).toBe(true);

      const scannedItem: ScannedItem = {
        id: 'item-link-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Junction Link',
        path: linkInsideRule,
        size: fp!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp!,
        explanation: {
          whyItExists: 'Test junction',
          consequenceOfRemoval: 'Unlinks junction only',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };
      sessionManager.registerItem(session.id, scannedItem);

      // 4. Execute cleanup on the junction
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        selectedItemIds: ['item-link-1'],
        ruleRoot,
        dryRun: false
      });

      expect(tx.status).toBe('COMPLETED');
      expect(tx.deletedCount).toBe(1);

      // 5. Verify the junction link itself was unlinked
      expect(fs.existsSync(linkInsideRule)).toBe(false);

      // 6. CRUCIAL INVARIANT: External target directory and its contents MUST be intact!
      expect(fs.existsSync(importantFile)).toBe(true);
      expect(fs.readFileSync(importantFile, 'utf8')).toBe('CRITICAL USER DATA');
    });
  });

  describe('3. Anti-TOCTOU & Metadata Fingerprinting', () => {
    it('detects when a file has changed since scan and safely aborts its deletion', async () => {
      const fileToMutate = path.join(ruleRoot, 'dynamic.cache');
      fs.writeFileSync(fileToMutate, 'Initial content of cache', 'utf8');

      const session = sessionManager.createSession();
      const fp = await FingerprintService.capture(fileToMutate);
      expect(fp).not.toBeNull();

      const item: ScannedItem = {
        id: 'item-mutate-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Dynamic Cache',
        path: fileToMutate,
        size: fp!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp!,
        explanation: {
          whyItExists: 'Test cache',
          consequenceOfRemoval: 'Cleaned',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };
      sessionManager.registerItem(session.id, item);

      // Mutate file after scan: change size and mtime
      await new Promise(r => setTimeout(r, 600)); // Ensure mtime difference
      fs.appendFileSync(fileToMutate, ' --- NEW UNCHECKED DATA APPENDED BY RUNNING APP ---');

      // Attempt cleanup
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        selectedItemIds: ['item-mutate-1'],
        ruleRoot,
        dryRun: false
      });

      // Item should have been skipped due to anti-TOCTOU fingerprint mismatch
      expect(tx.deletedCount).toBe(0);
      expect(tx.skippedCount).toBe(1);
      expect(tx.skippedDetails[0].reason).toContain('Item altered since scan');
      expect(fs.existsSync(fileToMutate)).toBe(true);
    });
  });

  describe('4. Windows File Lock & Graceful Skip', () => {
    it('skips locked files gracefully without failing the entire cleanup batch', async () => {
      const lockedFile = path.join(ruleRoot, 'locked_by_proc.log');
      const normalFile = path.join(ruleRoot, 'normal_removable.log');

      fs.writeFileSync(lockedFile, 'Locked file contents', 'utf8');
      fs.writeFileSync(normalFile, 'Normal removable file contents', 'utf8');

      const session = sessionManager.createSession();
      const fpLocked = (await FingerprintService.capture(lockedFile))!;
      const fpNormal = (await FingerprintService.capture(normalFile))!;

      const itemLocked: ScannedItem = {
        id: 'item-locked',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Locked Log',
        path: lockedFile,
        size: fpLocked.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fpLocked,
        explanation: {
          whyItExists: 'Locked file',
          consequenceOfRemoval: 'Clean',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };

      const itemNormal: ScannedItem = {
        id: 'item-normal',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Normal Log',
        path: normalFile,
        size: fpNormal.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fpNormal,
        explanation: {
          whyItExists: 'Normal file',
          consequenceOfRemoval: 'Clean',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };

      sessionManager.registerItem(session.id, itemLocked);
      sessionManager.registerItem(session.id, itemNormal);

      // Simulate Windows process lock (EBUSY / EPERM) on the locked file
      const originalUnlink = fs.promises.unlink.bind(fs.promises);
      const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async (targetPath) => {
        if (targetPath.toString().includes('locked_by_proc')) {
          const err: any = new Error('EBUSY: resource busy or locked by another Windows process');
          err.code = 'EBUSY';
          throw err;
        }
        return originalUnlink(targetPath);
      });

      try {
        const tx = await cleanupExecutor.execute({
          scanSessionId: session.id,
          ruleId: 'TEST_RULE',
          selectedItemIds: ['item-locked', 'item-normal'],
          ruleRoot,
          dryRun: false
        });

        // The normal file should be deleted, locked file should be skipped gracefully
        expect(tx.deletedCount).toBe(1);
        expect(tx.skippedCount).toBe(1);
        expect(tx.status).toBe('PARTIAL');
        expect(tx.skippedDetails[0].reason).toContain('EBUSY');
        expect(fs.existsSync(normalFile)).toBe(false);
        expect(fs.existsSync(lockedFile)).toBe(true);
      } finally {
        unlinkSpy.mockRestore();
      }
    });
  });

  describe('5. Dry Run Mode', () => {
    it('simulates space recovery without deleting physical files', async () => {
      const sampleFile = path.join(ruleRoot, 'sample.cache');
      fs.writeFileSync(sampleFile, 'Cache data for dry run test', 'utf8');

      const session = sessionManager.createSession();
      const fp = (await FingerprintService.capture(sampleFile))!;

      const item: ScannedItem = {
        id: 'item-dry',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Dry Run Sample',
        path: sampleFile,
        size: fp.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp,
        explanation: {
          whyItExists: 'Dry run cache',
          consequenceOfRemoval: 'None',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };
      sessionManager.registerItem(session.id, item);

      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        selectedItemIds: ['item-dry'],
        ruleRoot,
        dryRun: true
      });

      expect(tx.dryRun).toBe(true);
      expect(tx.status).toBe('COMPLETED');
      expect(tx.deletedCount).toBe(1);
      expect(tx.bytesReclaimed).toBe(fp.size);
      // File still exists on disk!
      expect(fs.existsSync(sampleFile)).toBe(true);
    });
  });

  describe('6. Cancellation Lifecycle', () => {
    it('aborts execution when AbortSignal is triggered', async () => {
      const sampleFile = path.join(ruleRoot, 'cancel.cache');
      fs.writeFileSync(sampleFile, 'Cancel cache', 'utf8');

      const session = sessionManager.createSession();
      const fp = (await FingerprintService.capture(sampleFile))!;

      const item: ScannedItem = {
        id: 'item-cancel',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Cancel Sample',
        path: sampleFile,
        size: fp.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp,
        explanation: {
          whyItExists: 'Cancel cache',
          consequenceOfRemoval: 'None',
          potentialImpact: 'None',
          safetyConfidence: 'SAFE'
        }
      };
      sessionManager.registerItem(session.id, item);

      const controller = new AbortController();
      controller.abort(); // Pre-abort

      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        selectedItemIds: ['item-cancel'],
        ruleRoot,
        dryRun: false,
        abortSignal: controller.signal
      });

      expect(tx.status).toBe('CANCELLED');
      expect(tx.deletedCount).toBe(0);
      expect(fs.existsSync(sampleFile)).toBe(true);
    });
  });

  describe('7. Collision-Free Item ID Generation & Distinct Registration', () => {
    it('generates distinct IDs for files with identical path prefixes across different rules', async () => {
      const scanner = new (await import('../packages/safety-engine/src/DirectoryScanner.js')).DirectoryScanner(protectedService);
      const registry = new (await import('../packages/cleanup-rules/src/RuleRegistry.js')).RuleRegistry();

      const tempDir1 = path.join(tempTestDir, 'temp-scope');
      const tempDir2 = path.join(tempTestDir, 'npm-scope');
      fs.mkdirSync(tempDir1, { recursive: true });
      fs.mkdirSync(tempDir2, { recursive: true });

      fs.writeFileSync(path.join(tempDir1, 'child.log'), 'data1');
      fs.writeFileSync(path.join(tempDir2, 'child.log'), 'data2');

      const rule1 = registry.getRule('WINDOWS_USER_TEMP')!;
      const rule2 = registry.getRule('NODE_NPM_CACHE')!;

      const items1 = await scanner.scanTarget({
        scanSessionId: 'SESSION-COLLISION-TEST',
        rule: rule1,
        targetRoot: tempDir1
      });

      const items2 = await scanner.scanTarget({
        scanSessionId: 'SESSION-COLLISION-TEST',
        rule: rule2,
        targetRoot: tempDir2
      });

      expect(items1.length).toBe(1);
      expect(items2.length).toBe(1);
      // Critical check: IDs MUST NOT collide even though entry names and prefixes are similar
      expect(items1[0].id).not.toBe(items2[0].id);
      expect(items1[0].ruleId).toBe('WINDOWS_USER_TEMP');
      expect(items2[0].ruleId).toBe('NODE_NPM_CACHE');
    });
  });

  describe('8. Pause & Resume Controls', () => {
    it('pauses and resumes directory scanning without terminating or failing', async () => {
      const { PauseController } = await import('../packages/safety-engine/src/PauseController.js');
      const pauseController = new PauseController();

      expect(pauseController.isPaused).toBe(false);
      pauseController.pause();
      expect(pauseController.isPaused).toBe(true);

      let waitFinished = false;
      const waitPromise = pauseController.waitIfPaused().then(() => {
        waitFinished = true;
      });

      // While paused, waitIfPaused() should block
      await new Promise(r => setTimeout(r, 50));
      expect(waitFinished).toBe(false);

      // Resuming should resolve the wait
      pauseController.resume();
      await waitPromise;
      expect(waitFinished).toBe(true);
      expect(pauseController.isPaused).toBe(false);
    });
  });

  describe('9. Interactive Cleanup Progress & Controls', () => {
    it('streams real-time cleanup progress events with items left and reclaimed bytes', async () => {
      const file1 = path.join(ruleRoot, 'progress-test-1.tmp');
      const file2 = path.join(ruleRoot, 'progress-test-2.tmp');
      fs.writeFileSync(file1, 'data1', 'utf8');
      fs.writeFileSync(file2, 'data2', 'utf8');

      const session = sessionManager.createSession();
      const fp1 = await FingerprintService.capture(file1);
      const fp2 = await FingerprintService.capture(file2);

      const item1: ScannedItem = {
        id: 'item-prog-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Progress 1',
        path: file1,
        size: fp1!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp1!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      };

      const item2: ScannedItem = {
        id: 'item-prog-2',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Progress 2',
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

      const progressEvents: any[] = [];
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        ruleRoot,
        selectedItemIds: ['item-prog-1', 'item-prog-2'],
        dryRun: false,
        onProgress: (prog) => {
          progressEvents.push(prog);
        }
      });

      expect(tx.status).toBe('COMPLETED');
      expect(tx.deletedCount).toBe(2);
      expect(progressEvents.length).toBeGreaterThan(0);

      // Verify progress tracking
      const finalEvent = progressEvents[progressEvents.length - 1];
      expect(finalEvent.deletedCount).toBe(2);
      expect(finalEvent.itemsLeft).toBe(0);
      expect(finalEvent.totalItems).toBe(2);
    });

    it('gracefully aborts cleanup when abortSignal is triggered', async () => {
      const file = path.join(ruleRoot, 'abort-test.tmp');
      fs.writeFileSync(file, 'abort data', 'utf8');

      const session = sessionManager.createSession();
      const fp = await FingerprintService.capture(file);
      const item: ScannedItem = {
        id: 'item-abort-1',
        ruleId: 'TEST_RULE',
        category: 'SYSTEM',
        label: 'Abort Test',
        path: file,
        size: fp!.size,
        fileCount: 1,
        safetyLevel: 'SAFE',
        selectedByDefault: true,
        fingerprint: fp!,
        explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
      };
      sessionManager.registerItem(session.id, item);

      const abortController = new AbortController();
      abortController.abort(); // Pre-aborted

      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'TEST_RULE',
        ruleRoot,
        selectedItemIds: ['item-abort-1'],
        dryRun: false,
        abortSignal: abortController.signal
      });

      expect(tx.status).toBe('CANCELLED');
      expect(fs.existsSync(file)).toBe(true); // File was spared!
    });
  });
});
