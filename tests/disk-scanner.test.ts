import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DiskService } from '../packages/safety-engine/src/DiskService.js';
import { EnvironmentDetector } from '../packages/safety-engine/src/EnvironmentDetector.js';
import { DirectoryScanner } from '../packages/safety-engine/src/DirectoryScanner.js';
import { ProtectedPathService } from '../packages/safety-engine/src/ProtectedPathService.js';
import { RuleRegistry } from '../packages/cleanup-rules/src/RuleRegistry.js';

describe('DiskService & Environment Detection', () => {
  it('retrieves system drive statistics using native statfs (C:)', async () => {
    const stats = await DiskService.getDriveStats('C:');
    console.log('REAL C: STATS =', stats);
    expect(stats).not.toBeNull();
    expect(stats!.caption).toBe('C:');
    expect(stats!.totalBytes).toBeGreaterThan(0);
    expect(stats!.freeBytes).toBeGreaterThan(0);
    expect(stats!.percentUsed).toBeGreaterThanOrEqual(0);
    expect(stats!.percentUsed).toBeLessThanOrEqual(100);
  });

  it('enumerates all available drives without WMIC', async () => {
    const drives = await DiskService.getAllDrives();
    expect(drives.length).toBeGreaterThan(0);
    expect(drives.some(d => d.caption.startsWith('C'))).toBe(true);
  });

  it('detects developer environment tools (Node, Git)', async () => {
    const tools = await EnvironmentDetector.detectAll();
    expect(tools.length).toBeGreaterThanOrEqual(8);

    const node = tools.find(t => t.id === 'node');
    expect(node?.detected).toBe(true);
    expect(node?.version).toContain('v');

    const git = tools.find(t => t.id === 'git');
    expect(git?.detected).toBe(true);
  });
});

describe('DirectoryScanner Bounded Concurrency & Progress Batching', () => {
  it('scans target directory with progress callbacks and measures size accurately', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsweep-scan-test-'));
    const subFolder = path.join(tempDir, 'cache-bucket');
    fs.mkdirSync(subFolder, { recursive: true });

    fs.writeFileSync(path.join(subFolder, 'file1.bin'), Buffer.alloc(1024 * 10)); // 10KB
    fs.writeFileSync(path.join(subFolder, 'file2.bin'), Buffer.alloc(1024 * 20)); // 20KB

    const protectedService = new ProtectedPathService();
    const scanner = new DirectoryScanner(protectedService);
    const registry = new RuleRegistry();
    const tempRule = registry.getRule('WINDOWS_USER_TEMP')!;

    let progressCalls = 0;
    const items = await scanner.scanTarget({
      scanSessionId: 'TEST-SESSION-SCAN',
      rule: tempRule,
      targetRoot: tempDir,
      onProgress: () => {
        progressCalls++;
      }
    });

    expect(items.length).toBe(1);
    expect(items[0].label).toBe('cache-bucket');
    expect(items[0].size).toBe(1024 * 30);
    expect(items[0].fileCount).toBe(2);
    expect(progressCalls).toBeGreaterThan(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
