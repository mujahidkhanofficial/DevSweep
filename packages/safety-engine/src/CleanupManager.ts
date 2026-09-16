import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SafetyEngine } from './SafetyEngine.js';
import { PauseController } from './PauseController.js';
import { CleanupTransaction, ScannedItem } from '../../shared/src/rules.types.js';
import { CleanupProgressEvent, HeartbeatStatus } from '../../shared/src/disk.types.js';
import { executeWorkerDeletion, WorkerProgressMessage, WorkerResultMessage } from './worker/cleanup.worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CleanupManagerOptions {
  scanSessionId: string;
  ruleId?: string;
  selectedItemIds: string[];
  ruleRoot?: string;
  dryRun: boolean;
  concurrency?: number;
  abortSignal?: AbortSignal;
  pauseController?: PauseController;
  onProgress?: (event: CleanupProgressEvent) => void;
}

interface ApprovedCandidate {
  item: ScannedItem;
  ruleRoot: string;
}

export class CleanupManager {
  constructor(
    private safetyEngine: SafetyEngine,
    private ruleRegistry?: { getRule: (id: string) => any }
  ) {}

  public static classifyHeartbeat(lastActivityTimestamp: number): HeartbeatStatus {
    const diff = Math.max(0, Date.now() - lastActivityTimestamp);
    if (diff < 2000) return 'ACTIVE';
    if (diff < 10000) return 'WORKING';
    if (diff < 60000) return 'SLOW';
    return 'STALLED';
  }

  public classifyHeartbeat(lastActivityTimestamp: number): HeartbeatStatus {
    return CleanupManager.classifyHeartbeat(lastActivityTimestamp);
  }

  public async execute(options: CleanupManagerOptions): Promise<CleanupTransaction> {
    const transactionId = `TX-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const tx: CleanupTransaction = {
      transactionId,
      scanSessionId: options.scanSessionId,
      ruleId: options.ruleId || 'BATCH_ALL',
      status: 'PENDING',
      dryRun: options.dryRun,
      startedAt: Date.now(),
      totalRequested: options.selectedItemIds.length,
      validatedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      timedOutCount: 0,
      cancelledCount: 0,
      bytesReclaimed: 0,
      skippedDetails: []
    };

    const startTime = Date.now();
    const totalRequested = options.selectedItemIds.length;

    // Terminal accounting state
    let completedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let timedOutCount = 0;
    let cancelledCount = 0;

    // Active item hierarchical telemetry
    let activeItem: ApprovedCandidate | null = null;
    let activeItemState: CleanupProgressEvent['activeItemState'] = 'PENDING';
    let currentOperation = 'Preparing candidates…';
    let discoveryState: CleanupProgressEvent['discoveryState'] = 'DISCOVERING';
    let filesDiscovered = 0;
    let filesProcessed = 0;
    let filesDeleted = 0;
    let filesSkipped = 0;
    let itemBytesReclaimed = 0;
    let heartbeatStatus: HeartbeatStatus = 'ACTIVE';
    let heartbeatMessage = 'Active';

    const emitProgress = (sessionStatus: CleanupProgressEvent['status'], totalBytesToReclaim: number) => {
      if (!options.onProgress) return;
      const now = Date.now();
      const elapsed = Math.max(1, now - startTime);
      const terminalCount = completedCount + skippedCount + failedCount + timedOutCount + cancelledCount;
      const itemsLeft = Math.max(0, totalRequested - terminalCount);

      const bytesPerSecond = tx.bytesReclaimed > 0 ? Math.round((tx.bytesReclaimed / elapsed) * 1000) : 0;
      let estimatedRemainingTimeMs = 0;
      if (totalBytesToReclaim > tx.bytesReclaimed && bytesPerSecond > 0) {
        estimatedRemainingTimeMs = Math.round(((totalBytesToReclaim - tx.bytesReclaimed) / bytesPerSecond) * 1000);
      } else if (itemsLeft > 0 && terminalCount > 0) {
        const msPerItem = elapsed / terminalCount;
        estimatedRemainingTimeMs = Math.round(itemsLeft * msPerItem);
      }

      options.onProgress({
        transactionId,
        scanSessionId: options.scanSessionId,
        status: sessionStatus,

        // Session level (strictly terminal metrics)
        totalItems: totalRequested,
        processedItems: terminalCount,
        deletedItems: completedCount,
        skippedItems: skippedCount,
        failedItems: failedCount,
        timedOutItems: timedOutCount,
        cancelledItems: cancelledCount,
        totalBytesToReclaim,
        bytesReclaimed: tx.bytesReclaimed,

        // Active item level
        activeItemId: activeItem?.item.id,
        activeItemName: activeItem?.item.label,
        activeItemPath: activeItem?.item.path,
        activeItemState,
        currentOperation,
        discoveryState,
        filesDiscovered,
        filesProcessed,
        filesDeleted,
        filesSkipped,
        itemBytesReclaimed,
        itemTotalBytes: activeItem?.item.size || 0,

        // Heartbeat
        heartbeatStatus,
        heartbeatMessage,

        // Telemetry
        bytesPerSecond,
        elapsedTimeMs: elapsed,
        estimatedRemainingTimeMs,

        // Compatibility
        currentItemIndex: terminalCount + (activeItem ? 1 : 0),
        currentItemName: activeItem?.item.label || '',
        currentPath: activeItem?.item.path || '',
        deletedCount: completedCount,
        skippedCount,
        itemsLeft
      });
    };

    // Step 1: Pre-validation of requested candidates
    tx.status = 'VALIDATING';
    activeItemState = 'VALIDATING';
    currentOperation = 'Validating candidate security boundaries…';
    emitProgress('VALIDATING', 0);

    const ruleRootsCache = new Map<string, string>();
    if (options.ruleId && options.ruleRoot) {
      ruleRootsCache.set(options.ruleId, options.ruleRoot);
    }

    const approvedItems: ApprovedCandidate[] = [];

    for (let i = 0; i < options.selectedItemIds.length; i++) {
      if (options.abortSignal?.aborted) {
        cancelledCount = totalRequested - (completedCount + skippedCount + failedCount);
        tx.cancelledCount = cancelledCount;
        tx.status = 'CANCELLED';
        tx.completedAt = Date.now();
        emitProgress('CANCELLED', 0);
        return tx;
      }

      const itemId = options.selectedItemIds[i];
      let itemRuleId = options.ruleId;
      let itemRuleRoot = options.ruleRoot;

      if (!itemRuleId || !itemRuleRoot) {
        const candidate = this.safetyEngine.getSessionManager().getItem(options.scanSessionId, itemId);
        if (!candidate) {
          skippedCount++;
          tx.skippedDetails.push({ path: itemId, reason: 'Item not found in current scan session' });
          continue;
        }
        itemRuleId = candidate.ruleId;

        if (ruleRootsCache.has(itemRuleId)) {
          itemRuleRoot = ruleRootsCache.get(itemRuleId)!;
        } else if (this.ruleRegistry) {
          const rule = this.ruleRegistry.getRule(itemRuleId);
          if (rule) {
            const targets = await rule.resolveTargets();
            const canonicalRoot: string = targets.length > 0 ? targets[0].canonicalPath : '';
            itemRuleRoot = canonicalRoot;
            ruleRootsCache.set(itemRuleId, canonicalRoot);
          }
        }
      }

      if (!itemRuleId || !itemRuleRoot) {
        skippedCount++;
        tx.skippedDetails.push({ path: itemId, reason: `Could not resolve rule root for rule "${itemRuleId}"` });
        continue;
      }

      const validation = await this.safetyEngine.validateCandidateForCleanup(
        options.scanSessionId,
        itemRuleId,
        itemId,
        itemRuleRoot
      );

      if (validation.allowed && validation.item) {
        approvedItems.push({ item: validation.item, ruleRoot: itemRuleRoot });
        tx.validatedCount++;
      } else {
        skippedCount++;
        tx.skippedDetails.push({
          path: itemId,
          reason: validation.reason || 'Failed safety containment or fingerprint validation'
        });
      }
    }

    const totalBytesToReclaim = approvedItems.reduce((acc, it) => acc + it.item.size, 0);

    // Step 2: Execution Phase
    tx.status = 'RUNNING';

    for (let idx = 0; idx < approvedItems.length; idx++) {
      // Check cancellation checkpoint
      if (options.abortSignal?.aborted) {
        cancelledCount = totalRequested - (completedCount + skippedCount + failedCount);
        activeItemState = 'CANCELLED';
        currentOperation = 'Cleanup cancelled by user';
        tx.status = 'CANCELLED';
        emitProgress('CANCELLED', totalBytesToReclaim);
        break;
      }

      // Check pause checkpoint (Queue Pause: active item finishes before pause engages)
      if (options.pauseController) {
        if (options.pauseController.isPaused) {
          emitProgress('PAUSED', totalBytesToReclaim);
        }
        await options.pauseController.waitIfPaused();
        if (options.abortSignal?.aborted) {
          cancelledCount = totalRequested - (completedCount + skippedCount + failedCount);
          activeItemState = 'CANCELLED';
          tx.status = 'CANCELLED';
          emitProgress('CANCELLED', totalBytesToReclaim);
          break;
        }
      }

      activeItem = approvedItems[idx];
      activeItemState = 'RUNNING';
      currentOperation = `Processing ${activeItem.item.label}…`;
      discoveryState = 'DISCOVERING';
      filesDiscovered = 0;
      filesProcessed = 0;
      filesDeleted = 0;
      filesSkipped = 0;
      itemBytesReclaimed = 0;
      heartbeatStatus = 'ACTIVE';
      heartbeatMessage = 'Active';

      emitProgress('RUNNING', totalBytesToReclaim);

      try {
        const itemResult = await this.executeItemWithWorkerOrDirect(
          activeItem,
          options.dryRun,
          options.concurrency || 6,
          options.abortSignal,
          (prog) => {
            discoveryState = prog.discoveryState;
            currentOperation = prog.currentOperation;
            filesDiscovered = prog.filesDiscovered;
            filesProcessed = prog.filesProcessed;
            filesDeleted = prog.filesDeleted;
            filesSkipped = prog.filesSkipped;
            itemBytesReclaimed = prog.bytesReclaimed;
            heartbeatStatus = prog.heartbeatStatus;
            heartbeatMessage = prog.heartbeatMessage;
            emitProgress('RUNNING', totalBytesToReclaim);
          }
        );

        tx.bytesReclaimed += itemResult.bytesReclaimed;

        if (itemResult.wasCancelled) {
          activeItemState = 'CANCELLED';
          cancelledCount++;
          tx.status = 'CANCELLED';
          emitProgress('CANCELLED', totalBytesToReclaim);
          break;
        }

        if (itemResult.success && itemResult.filesSkipped === 0) {
          activeItemState = 'COMPLETED';
          completedCount++;
        } else if (itemResult.filesDeleted > 0 && itemResult.filesSkipped > 0) {
          activeItemState = 'COMPLETED'; // Partial removal of directory
          completedCount++;
          if (itemResult.skippedDetails.length > 0) {
            tx.skippedDetails.push(...itemResult.skippedDetails);
          }
        } else if (itemResult.filesSkipped > 0) {
          activeItemState = 'SKIPPED';
          skippedCount++;
          if (itemResult.skippedDetails.length > 0) {
            tx.skippedDetails.push(...itemResult.skippedDetails);
          }
        } else {
          activeItemState = 'FAILED';
          failedCount++;
          tx.skippedDetails.push({
            path: activeItem.item.path,
            reason: itemResult.error || 'Failed to clean item'
          });
        }
      } catch (err: any) {
        activeItemState = 'FAILED';
        failedCount++;
        tx.skippedDetails.push({
          path: activeItem.item.path,
          reason: `Execution failure: ${err.message}`
        });
      }

      emitProgress('RUNNING', totalBytesToReclaim);
    }

    // Step 3: Terminal Accounting & State Verification
    tx.deletedCount = completedCount;
    tx.skippedCount = skippedCount;
    tx.failedCount = failedCount;
    tx.timedOutCount = timedOutCount;
    tx.cancelledCount = cancelledCount;

    // Strict invariant check:
    const terminalTotal = completedCount + skippedCount + failedCount + timedOutCount + cancelledCount;
    if (terminalTotal < totalRequested) {
      const remainingUnaccounted = totalRequested - terminalTotal;
      if (options.abortSignal?.aborted) {
        tx.cancelledCount += remainingUnaccounted;
      } else {
        tx.skippedCount += remainingUnaccounted;
      }
    }

    if (tx.status !== 'CANCELLED') {
      if (tx.failedCount > 0 && tx.deletedCount === 0) {
        tx.status = 'FAILED';
      } else if (tx.skippedCount > 0 || tx.timedOutCount > 0) {
        tx.status = tx.deletedCount > 0 ? 'PARTIAL' : 'FAILED';
      } else {
        tx.status = 'COMPLETED';
      }
    }

    activeItem = null;
    activeItemState = 'COMPLETED';
    currentOperation = 'Cleanup finished';
    emitProgress(tx.status, totalBytesToReclaim);

    tx.completedAt = Date.now();
    return tx;
  }

  /**
   * Executes item deletion using worker threads when available, with safe direct
   * execution fallback in headless/test environments.
   */
  private async executeItemWithWorkerOrDirect(
    candidate: ApprovedCandidate,
    dryRun: boolean,
    concurrency: number,
    abortSignal?: AbortSignal,
    onProgress?: (prog: WorkerProgressMessage) => void
  ): Promise<WorkerResultMessage> {
    const payload = {
      taskId: candidate.item.id,
      itemPath: candidate.item.path,
      ruleRoot: candidate.ruleRoot,
      dryRun,
      concurrency
    };

    // Check if worker file exists on disk (built electron worker or test environment)
    const possibleWorkerPaths = [
      path.join(__dirname, '../workers/cleanup.worker.js'),
      path.join(__dirname, 'worker/cleanup.worker.js'),
      path.join(__dirname, 'worker/cleanup.worker.ts')
    ];

    let workerPath: string | null = null;
    for (const p of possibleWorkerPaths) {
      if (fs.existsSync(p) && !p.endsWith('.ts')) {
        workerPath = p;
        break;
      }
    }

    // If worker file exists as compiled JS and worker_threads supported, run via Worker
    if (workerPath && typeof Worker === 'function') {
      return new Promise<WorkerResultMessage>((resolve) => {
        let isSettled = false;
        let worker: Worker | null = null;

        const settle = (res: WorkerResultMessage) => {
          if (isSettled) return;
          isSettled = true;
          try {
            worker?.terminate();
          } catch {}
          resolve(res);
        };

        try {
          worker = new Worker(workerPath);

          if (abortSignal) {
            abortSignal.addEventListener('abort', () => {
              worker?.postMessage({ type: 'CANCEL' });
            });
          }

          worker.on('message', (msg: any) => {
            if (msg.type === 'PROGRESS') {
              onProgress?.(msg);
            } else if (msg.type === 'RESULT') {
              settle(msg);
            }
          });

          worker.on('error', (err: Error) => {
            settle({
              type: 'RESULT',
              taskId: candidate.item.id,
              success: false,
              bytesReclaimed: 0,
              filesProcessed: 0,
              filesDeleted: 0,
              filesSkipped: 1,
              skippedDetails: [{ path: candidate.item.path, reason: `Worker thread error: ${err.message}` }],
              error: err.message,
              wasCancelled: abortSignal?.aborted ?? false
            });
          });

          worker.on('exit', (code: number) => {
            if (!isSettled) {
              settle({
                type: 'RESULT',
                taskId: candidate.item.id,
                success: false,
                bytesReclaimed: 0,
                filesProcessed: 0,
                filesDeleted: 0,
                filesSkipped: 1,
                skippedDetails: [{ path: candidate.item.path, reason: `Worker exited unexpectedly with code ${code}` }],
                error: `Worker exited with code ${code}`,
                wasCancelled: abortSignal?.aborted ?? false
              });
            }
          });

          worker.postMessage({ type: 'START_TASK', payload });
        } catch (workerInitErr: any) {
          // Fallback to direct execution
          executeWorkerDeletion(payload, onProgress || (() => {}), () => abortSignal?.aborted ?? false)
            .then(resolve)
            .catch((err) =>
              resolve({
                type: 'RESULT',
                taskId: candidate.item.id,
                success: false,
                bytesReclaimed: 0,
                filesProcessed: 0,
                filesDeleted: 0,
                filesSkipped: 1,
                skippedDetails: [{ path: candidate.item.path, reason: err.message }],
                error: err.message,
                wasCancelled: abortSignal?.aborted ?? false
              })
            );
        }
      });
    }

    // Direct execution in Node/Vitest environment
    return executeWorkerDeletion(
      payload,
      onProgress || (() => {}),
      () => abortSignal?.aborted ?? false
    );
  }
}
