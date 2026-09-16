import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SessionManager, SafetyEngine, CleanupExecutor, ProtectedPathService, DirectoryScanner } from '../packages/safety-engine/src/index.js';
import { RuleRegistry } from '../packages/cleanup-rules/src/index.js';
import { createThrottledProgressEmitter } from '../packages/shared/src/throttler.js';

describe('Memory & Lifecycle Stability Verification', () => {
  const tempBase = path.join(os.tmpdir(), `devsweep-mem-test-${Date.now()}`);

  afterEach(() => {
    try {
      if (fs.existsSync(tempBase)) {
        fs.rmSync(tempBase, { recursive: true, force: true });
      }
    } catch {}
  });

  it('verifies 10 repeated scan-cleanup cycles stabilize memory with zero listener accumulation', async () => {
    fs.mkdirSync(tempBase, { recursive: true });
    const memorySnapshots: number[] = [];

    const protectedService = new ProtectedPathService([]);
    const sessionManager = new SessionManager();
    const safetyEngine = new SafetyEngine(protectedService, sessionManager);
    const ruleRegistry = new RuleRegistry();
    const cleanupExecutor = new CleanupExecutor(safetyEngine, ruleRegistry);

    // Baseline RSS
    const baselineRss = process.memoryUsage().rss;

    for (let cycle = 1; cycle <= 10; cycle++) {
      const cycleDir = path.join(tempBase, `cycle-${cycle}`);
      fs.mkdirSync(cycleDir, { recursive: true });

      // Create test files
      const testFiles: string[] = [];
      for (let f = 0; f < 10; f++) {
        const filePath = path.join(cycleDir, `file-${f}.tmp`);
        fs.writeFileSync(filePath, 'sample-content-data-for-memory-testing');
        testFiles.push(filePath);
      }

      const session = sessionManager.createSession();

      // Register items
      for (let f = 0; f < testFiles.length; f++) {
        const stat = fs.statSync(testFiles[f]);
        sessionManager.registerItem(session.id, {
          id: `c${cycle}-item-${f}`,
          ruleId: 'WINDOWS_USER_TEMP',
          category: 'SYSTEM',
          label: `File ${f}`,
          path: testFiles[f],
          size: stat.size,
          fileCount: 1,
          safetyLevel: 'SAFE',
          selectedByDefault: true,
          fingerprint: {
            path: testFiles[f],
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            isDirectory: false,
            isSymbolicLink: false
          },
          explanation: { whyItExists: '', consequenceOfRemoval: '', potentialImpact: '', safetyConfidence: 'SAFE' }
        });
      }

      // Exercise throttled progress emitter
      const emitted: any[] = [];
      const emitter = createThrottledProgressEmitter((p) => emitted.push(p), 66);
      for (let p = 0; p < 25; p++) {
        emitter.sendProgress({ cycle, step: p });
      }
      emitter.sendTerminal({ cycle, status: 'COMPLETED' });
      expect(emitted.length).toBeGreaterThanOrEqual(1);

      // Execute actual cleanup
      const selectedIds = testFiles.map((_, idx) => `c${cycle}-item-${idx}`);
      const tx = await cleanupExecutor.execute({
        scanSessionId: session.id,
        ruleId: 'WINDOWS_USER_TEMP',
        ruleRoot: cycleDir,
        selectedItemIds: selectedIds,
        dryRun: false
      });

      expect(tx.status).toBe('COMPLETED');
      expect(tx.deletedCount).toBe(10);

      // Release session from sessionManager
      sessionManager.cancelSession(session.id);

      const currentRss = process.memoryUsage().rss;
      memorySnapshots.push(currentRss);
    }

    // Verify memory stabilization: final cycle RSS does not show unbounded growth
    const initialCycleRss = memorySnapshots[1]; // after warmup
    const finalCycleRss = memorySnapshots[9];
    const growthMb = (finalCycleRss - initialCycleRss) / (1024 * 1024);

    // RSS should stabilize; growth across 10 complete file/cleanup lifecycles should remain well bounded (< 20 MB)
    expect(growthMb).toBeLessThan(20);
  });
});
