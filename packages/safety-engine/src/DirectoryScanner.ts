import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FingerprintService } from './FingerprintService.js';
import { ProtectedPathService } from './ProtectedPathService.js';
import { PauseController } from './PauseController.js';
import { ScannedItem, CleanupRule } from '../../shared/src/rules.types.js';
import { ScanProgressEvent } from '../../shared/src/disk.types.js';

export interface ScanOptions {
  scanSessionId: string;
  rule: CleanupRule;
  targetRoot: string;
  ruleIndex?: number;
  totalRules?: number;
  abortSignal?: AbortSignal;
  pauseController?: PauseController;
  onProgress?: (event: ScanProgressEvent) => void;
}

export class DirectoryScanner {
  private static readonly PROGRESS_FLUSH_INTERVAL_MS = 150; // 150ms aggregated batching

  constructor(private protectedService: ProtectedPathService) {}

  public async scanTarget(options: ScanOptions): Promise<ScannedItem[]> {
    const items: ScannedItem[] = [];
    const root = path.resolve(options.targetRoot);

    try {
      await fs.promises.access(root);
    } catch {
      // Target directory doesn't exist on disk
      return [];
    }

    let filesCount = 0;
    let bytesCount = 0;
    let lastFlushTime = Date.now();
    const startTime = Date.now();

    // Rolling sample window for throughput calculation
    let sampleTime = Date.now();
    let sampleFiles = 0;
    let sampleBytes = 0;
    let currentFps = 0;
    let currentBps = 0;

    const ruleIndex = options.ruleIndex ?? 1;
    const totalRules = options.totalRules ?? 1;

    const notifyProgress = (force = false, finalStatus?: ScanProgressEvent['status']) => {
      if (!options.onProgress) return;
      const now = Date.now();

      // Calculate rolling throughput every 500ms+
      const sampleDelta = now - sampleTime;
      if (sampleDelta >= 500) {
        currentFps = Math.round(((filesCount - sampleFiles) / sampleDelta) * 1000);
        currentBps = Math.round(((bytesCount - sampleBytes) / sampleDelta) * 1000);
        sampleTime = now;
        sampleFiles = filesCount;
        sampleBytes = bytesCount;
      }

      if (force || now - lastFlushTime >= DirectoryScanner.PROGRESS_FLUSH_INTERVAL_MS) {
        lastFlushTime = now;
        const elapsed = now - startTime;

        // Dynamic ETA calculation
        let estimatedRemainingTimeMs = 0;
        if (ruleIndex > 0 && totalRules > 0) {
          const rulesCompleted = ruleIndex - 1;
          const currentRuleFraction = totalRules > 0 ? (rulesCompleted + 0.5) / totalRules : 1;
          if (currentRuleFraction > 0 && currentRuleFraction < 1 && elapsed > 1000) {
            const totalProjected = elapsed / currentRuleFraction;
            estimatedRemainingTimeMs = Math.max(0, Math.round(totalProjected - elapsed));
          }
        }

        const isPaused = options.pauseController?.isPaused ?? false;
        const isCancelled = options.abortSignal?.aborted ?? false;
        const status = finalStatus || (isCancelled ? 'CANCELLED' : isPaused ? 'PAUSED' : 'SCANNING');

        options.onProgress({
          scanSessionId: options.scanSessionId,
          status,
          currentCategory: options.rule.category,
          currentRule: options.rule.name,
          currentRuleIndex: ruleIndex,
          totalRules,
          currentPath: root,
          scannedFiles: filesCount,
          scannedBytes: bytesCount,
          estimatedReclaimableBytes: bytesCount,
          filesPerSecond: Math.max(0, currentFps),
          bytesPerSecond: Math.max(0, currentBps),
          elapsedTimeMs: elapsed,
          estimatedRemainingTimeMs
        });
      }
    };

    // Read top-level children of the target root
    try {
      const topEntries = await fs.promises.readdir(root, { withFileTypes: true });

      for (const entry of topEntries) {
        if (options.abortSignal?.aborted) break;
        if (options.pauseController) {
          await options.pauseController.waitIfPaused();
        }

        const childPath = path.join(root, entry.name);

        // Protection check
        const protection = this.protectedService.checkPath(childPath, root);
        if (protection.isProtected) continue;

        const fp = await FingerprintService.capture(childPath);
        if (!fp) continue;

        let itemSize = fp.size;
        let fileCount = 1;

        if (fp.isDirectory && !fp.isSymbolicLink) {
          // Bounded recursive calculation of directory
          const dirStats = await this.measureDirectory(
            childPath,
            root,
            options.abortSignal,
            options.pauseController,
            (files, bytes) => {
              filesCount += files;
              bytesCount += bytes;
              notifyProgress();
            }
          );
          itemSize = dirStats.bytes;
          fileCount = dirStats.files;
        } else {
          filesCount += 1;
          bytesCount += itemSize;
          notifyProgress();
        }

        // Only add items that actually consume disk space
        if (itemSize > 0) {
          // Collision-free unique ID generated via SHA-256 digest of ruleId:childPath
          const id = `item-${crypto.createHash('sha256').update(`${options.rule.id}:${childPath}`).digest('hex').slice(0, 24)}`;

          const scannedItem: ScannedItem = {
            id,
            ruleId: options.rule.id,
            category: options.rule.category,
            toolchainId: options.rule.toolchainId,
            relatedToolchains: options.rule.relatedToolchains,
            label: entry.name,
            path: childPath,
            size: itemSize,
            fileCount,
            safetyLevel: options.rule.safetyLevel,
            selectedByDefault: options.rule.defaultSelection,
            fingerprint: fp,
            explanation: options.rule.explain()
          };

          items.push(scannedItem);
        }
      }
    } catch {
      // Permission or access error at root level
    }

    notifyProgress(true);
    return items.sort((a, b) => b.size - a.size);
  }

  private async measureDirectory(
    dirPath: string,
    ruleRoot: string,
    abortSignal?: AbortSignal,
    pauseController?: PauseController,
    onDelta?: (files: number, bytes: number) => void
  ): Promise<{ files: number; bytes: number }> {
    let totalFiles = 0;
    let totalBytes = 0;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (abortSignal?.aborted) break;
        if (pauseController) {
          await pauseController.waitIfPaused();
        }

        const childPath = path.join(dirPath, entry.name);

        // Anti-traversal containment verification
        const rel = path.relative(ruleRoot, childPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;

        // Skip sensitive files (.git, .env, credentials)
        if (this.protectedService.checkPath(childPath, ruleRoot).isProtected) continue;

        // Reparse point / junction invariant: do NOT recursively descend!
        if (entry.isSymbolicLink()) {
          try {
            const linkStat = await fs.promises.lstat(childPath);
            totalFiles += 1;
            totalBytes += linkStat.size;
            onDelta?.(1, linkStat.size);
          } catch {
            // Ignored
          }
          continue;
        }

        if (entry.isDirectory()) {
          const sub = await this.measureDirectory(childPath, ruleRoot, abortSignal, pauseController, onDelta);
          totalFiles += sub.files;
          totalBytes += sub.bytes;
        } else {
          try {
            const fileStat = await fs.promises.lstat(childPath);
            totalFiles += 1;
            totalBytes += fileStat.size;
            onDelta?.(1, fileStat.size);
          } catch {
            // Ignored
          }
        }
      }
    } catch {
      // Access denied or folder disappeared during scan
    }

    return { files: totalFiles, bytes: totalBytes };
  }
}
