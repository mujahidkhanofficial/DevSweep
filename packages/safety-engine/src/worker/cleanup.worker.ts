import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { WindowsFileService, FileOperationResult } from '../WindowsFileService.js';
import { HeartbeatStatus } from '../../../shared/src/disk.types.js';

export interface WorkerTaskPayload {
  taskId: string;
  itemPath: string;
  ruleRoot: string;
  dryRun: boolean;
  concurrency?: number;
}

export interface WorkerProgressMessage {
  type: 'PROGRESS';
  taskId: string;
  discoveryState: 'DISCOVERING' | 'PROCESSING' | 'FINALIZING';
  currentOperation: string;
  filesDiscovered: number;
  filesProcessed: number;
  filesDeleted: number;
  filesSkipped: number;
  bytesReclaimed: number;
  heartbeatStatus: HeartbeatStatus;
  heartbeatMessage: string;
}

export interface WorkerResultMessage {
  type: 'RESULT';
  taskId: string;
  success: boolean;
  bytesReclaimed: number;
  filesProcessed: number;
  filesDeleted: number;
  filesSkipped: number;
  skippedDetails: Array<{ path: string; reason: string; errorCode?: string; operation?: string }>;
  error?: string;
  wasCancelled: boolean;
}

export class BoundedConcurrencyQueue {
  private active = 0;
  private queue: Array<() => Promise<void>> = [];
  private cancelled = false;

  constructor(public readonly limit: number = 6) {}

  public cancel(): void {
    this.cancelled = true;
    this.queue = [];
  }

  public get isCancelled(): boolean {
    return this.cancelled;
  }

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.cancelled) {
      return Promise.reject(new Error('Queue cancelled'));
    }

    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        if (this.cancelled) {
          resolve(undefined as any);
          return;
        }
        this.active++;
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          this.active--;
          this.next();
        }
      };

      if (this.active < this.limit) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private next(): void {
    if (this.cancelled) return;
    if (this.queue.length > 0 && this.active < this.limit) {
      const nextTask = this.queue.shift();
      if (nextTask) nextTask();
    }
  }

  public async drain(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

/**
 * Worker deletion engine implementing bounded concurrency, hierarchical progress,
 * and child-level error isolation.
 */
export async function executeWorkerDeletion(
  payload: WorkerTaskPayload,
  onProgress: (p: WorkerProgressMessage) => void,
  isCancelled: () => boolean
): Promise<WorkerResultMessage> {
  const { taskId, itemPath, ruleRoot, dryRun, concurrency = 6 } = payload;

  const result: WorkerResultMessage = {
    type: 'RESULT',
    taskId,
    success: true,
    bytesReclaimed: 0,
    filesProcessed: 0,
    filesDeleted: 0,
    filesSkipped: 0,
    skippedDetails: [],
    wasCancelled: false
  };

  let filesDiscovered = 0;
  let discoveryState: 'DISCOVERING' | 'PROCESSING' | 'FINALIZING' = 'DISCOVERING';
  let currentOperation = 'Inspecting candidate…';
  let lastActivityTimestamp = Date.now();
  let lastProgressEmit = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressEmit < 150) return;
    lastProgressEmit = now;

    const idleTime = now - lastActivityTimestamp;
    let heartbeatStatus: HeartbeatStatus = 'ACTIVE';
    let heartbeatMessage = 'Active';

    if (idleTime > 60000) {
      heartbeatStatus = 'STALLED';
      heartbeatMessage = 'Filesystem taking longer than expected…';
    } else if (idleTime > 10000) {
      heartbeatStatus = 'SLOW';
      heartbeatMessage = 'Filesystem operation in progress…';
    } else if (idleTime > 2000) {
      heartbeatStatus = 'WORKING';
      heartbeatMessage = 'Working…';
    }

    onProgress({
      type: 'PROGRESS',
      taskId,
      discoveryState,
      currentOperation,
      filesDiscovered,
      filesProcessed: result.filesProcessed,
      filesDeleted: result.filesDeleted,
      filesSkipped: result.filesSkipped,
      bytesReclaimed: result.bytesReclaimed,
      heartbeatStatus,
      heartbeatMessage
    });
  };

  // 1. Boundary & Containment Check
  const normalizedTarget = path.resolve(itemPath);
  const normalizedRoot = path.resolve(ruleRoot);
  const rel = path.relative(normalizedRoot, normalizedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ...result,
      success: false,
      error: `Path "${itemPath}" is outside the authorized rule boundary "${ruleRoot}"`
    };
  }

  // 2. lstat target
  let stats: fs.Stats;
  try {
    stats = await fs.promises.lstat(normalizedTarget);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { ...result, success: true };
    }
    return { ...result, success: false, error: err.message };
  }

  // 3. Reparse point invariant: Never recurse into symlink or junction
  if (stats.isSymbolicLink()) {
    currentOperation = 'Unlinking junction/symlink…';
    emitProgress(true);
    const unlinked = await WindowsFileService.safeUnlinkReparsePoint(normalizedTarget);
    if (unlinked.success) {
      result.bytesReclaimed += unlinked.bytes;
      result.filesDeleted = 1;
      result.filesProcessed = 1;
      return result;
    } else {
      result.filesSkipped = 1;
      result.filesProcessed = 1;
      result.skippedDetails.push({
        path: normalizedTarget,
        reason: unlinked.errorMessage || 'Failed to unlink reparse point',
        errorCode: unlinked.rawErrorCode,
        operation: 'unlinkReparsePoint'
      });
      return result;
    }
  }

  // Single file target
  if (!stats.isDirectory()) {
    currentOperation = 'Removing file…';
    emitProgress(true);
    if (dryRun) {
      result.bytesReclaimed += stats.size;
      result.filesDeleted = 1;
      result.filesProcessed = 1;
      return result;
    }

    const unlinked = await WindowsFileService.safeUnlinkFile(normalizedTarget);
    if (unlinked.success) {
      result.bytesReclaimed += unlinked.bytes;
      result.filesDeleted = 1;
      result.filesProcessed = 1;
    } else {
      result.filesSkipped = 1;
      result.filesProcessed = 1;
      result.skippedDetails.push({
        path: normalizedTarget,
        reason: unlinked.errorMessage || 'Failed to remove file',
        errorCode: unlinked.rawErrorCode,
        operation: 'unlinkFile'
      });
    }
    return result;
  }

  // 4. Directory Deletion with Bounded Concurrency & Child Error Isolation
  const queue = new BoundedConcurrencyQueue(concurrency);
  const dirsToCleanUpLater: string[] = [];

  try {
    discoveryState = 'DISCOVERING';
    currentOperation = 'Scanning directory contents…';
    emitProgress(true);

    // Iterative Breadth-First directory walk
    const dirQueue: string[] = [normalizedTarget];
    const fileQueue: string[] = [];

    while (dirQueue.length > 0) {
      if (isCancelled()) {
        result.wasCancelled = true;
        break;
      }

      const currentDir = dirQueue.shift()!;
      if (currentDir !== normalizedTarget) {
        dirsToCleanUpLater.push(currentDir);
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        lastActivityTimestamp = Date.now();
      } catch (dirErr: any) {
        result.skippedDetails.push({
          path: currentDir,
          reason: `Could not read directory: ${dirErr.message}`,
          errorCode: dirErr.code,
          operation: 'readdir'
        });
        continue;
      }

      for (const entry of entries) {
        if (isCancelled()) break;
        const entryPath = path.join(currentDir, entry.name);

        // Reparse point check: do not follow junctions into subdirectories!
        if (entry.isSymbolicLink()) {
          fileQueue.push(entryPath);
          filesDiscovered++;
        } else if (entry.isDirectory()) {
          dirQueue.push(entryPath);
        } else {
          fileQueue.push(entryPath);
          filesDiscovered++;
        }
      }

      // Periodically emit discovery progress and yield
      emitProgress();
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (isCancelled()) {
      result.wasCancelled = true;
      return result;
    }

    // Processing Phase
    discoveryState = 'PROCESSING';
    currentOperation = `Deleting ${filesDiscovered} files…`;
    emitProgress(true);

    const deletionPromises: Promise<void>[] = [];

    for (let i = 0; i < fileQueue.length; i++) {
      if (isCancelled()) {
        queue.cancel();
        result.wasCancelled = true;
        break;
      }

      const filePath = fileQueue[i];

      const p = queue.enqueue(async () => {
        if (isCancelled() || queue.isCancelled) return;

        if (dryRun) {
          result.bytesReclaimed += 1024; // Representative simulation byte
          result.filesDeleted++;
          result.filesProcessed++;
          lastActivityTimestamp = Date.now();
          emitProgress();
          return;
        }

        // Check if reparse point
        const isReparse = await WindowsFileService.isReparsePointOrSymlink(filePath);
        let res: FileOperationResult;

        if (isReparse) {
          res = await WindowsFileService.safeUnlinkReparsePoint(filePath);
        } else {
          res = await WindowsFileService.safeUnlinkFile(filePath);
        }

        lastActivityTimestamp = Date.now();
        result.filesProcessed++;

        if (res.success) {
          result.filesDeleted++;
          result.bytesReclaimed += res.bytes;
        } else {
          result.filesSkipped++;
          result.skippedDetails.push({
            path: filePath,
            reason: res.errorMessage || 'Unable to delete child file',
            errorCode: res.rawErrorCode,
            operation: 'unlinkChild'
          });
        }

        emitProgress();
      });

      deletionPromises.push(p);

      // Yield event loop every 100 items
      if (i % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Wait for all in-flight file deletions to drain safely
    await queue.drain();
    await Promise.allSettled(deletionPromises);

    if (isCancelled()) {
      result.wasCancelled = true;
      return result;
    }

    // Finalizing Phase: Clean empty directories bottom-up
    discoveryState = 'FINALIZING';
    currentOperation = 'Removing empty folders…';
    emitProgress(true);

    // Reverse order ensures leaf directories are removed before parent directories
    dirsToCleanUpLater.reverse();
    for (const d of dirsToCleanUpLater) {
      if (isCancelled()) break;
      if (!dryRun) {
        await WindowsFileService.safeRemoveEmptyDirectory(d);
        lastActivityTimestamp = Date.now();
      }
    }

    // Finally, remove the root directory container if rel !== '' and not dry run
    if (!dryRun && rel !== '' && !isCancelled()) {
      const rmRoot = await WindowsFileService.safeRemoveEmptyDirectory(normalizedTarget);
      if (!rmRoot.success && result.filesSkipped === 0) {
        result.skippedDetails.push({
          path: normalizedTarget,
          reason: rmRoot.errorMessage || 'Directory could not be removed',
          errorCode: rmRoot.rawErrorCode,
          operation: 'rmdirTarget'
        });
      }
    }
  } catch (err: any) {
    result.success = false;
    result.error = err.message;
  }

  emitProgress(true);
  return result;
}

// Standalone Worker Thread Listeners (when invoked in worker_threads context)
if (parentPort) {
  let cancelled = false;

  parentPort.on('message', async (msg: any) => {
    if (msg.type === 'START_TASK') {
      cancelled = false;
      try {
        const res = await executeWorkerDeletion(
          msg.payload,
          (prog) => parentPort?.postMessage(prog),
          () => cancelled
        );
        parentPort?.postMessage(res);
      } catch (err: any) {
        parentPort?.postMessage({
          type: 'RESULT',
          taskId: msg.payload?.taskId || 'unknown',
          success: false,
          bytesReclaimed: 0,
          filesProcessed: 0,
          filesDeleted: 0,
          filesSkipped: 0,
          skippedDetails: [],
          error: err.message,
          wasCancelled: cancelled
        });
      }
    } else if (msg.type === 'CANCEL') {
      cancelled = true;
    }
  });
}
