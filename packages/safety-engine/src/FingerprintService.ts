import fs from 'fs';
import { ItemFingerprint } from '../../shared/src/rules.types.js';

export interface FingerprintValidationResult {
  valid: boolean;
  reason?: string;
  currentStats?: fs.Stats;
}

export class FingerprintService {
  /**
   * Captures initial metadata snapshot using lstat to avoid resolving symlinks/junctions
   */
  public static async capture(targetPath: string): Promise<ItemFingerprint | null> {
    try {
      const stats = await fs.promises.lstat(targetPath);
      return {
        path: targetPath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink()
      };
    } catch {
      return null;
    }
  }

  /**
   * Validates target immediately prior to deletion to guard against TOCTOU
   * (Time-Of-Check to Time-Of-Use) race conditions and unauthorized modifications
   */
  public static async validate(original: ItemFingerprint): Promise<FingerprintValidationResult> {
    try {
      const current = await fs.promises.lstat(original.path);

      // Check if file type changed (e.g. file became a symlink or directory)
      if (current.isSymbolicLink() !== original.isSymbolicLink) {
        return {
          valid: false,
          reason: 'Item changed to/from a symbolic link since the scan was performed'
        };
      }

      if (current.isDirectory() !== original.isDirectory) {
        return {
          valid: false,
          reason: 'Item changed between directory and file since the scan was performed'
        };
      }

      // For regular files, check if size or modification time changed unexpectedly
      if (!current.isDirectory() && !current.isSymbolicLink()) {
        const mtimeDelta = Math.abs(current.mtimeMs - original.mtimeMs);
        // Allow tiny sub-millisecond or clock drift difference
        if (mtimeDelta > 500 && current.size !== original.size) {
          return {
            valid: false,
            reason: `Item modified since scan (Size: ${original.size} -> ${current.size}, mtime delta: ${Math.round(mtimeDelta)}ms)`
          };
        }
      }

      return { valid: true, currentStats: current };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { valid: false, reason: 'Item no longer exists on disk' };
      }
      return { valid: false, reason: `Access error: ${err.message}` };
    }
  }
}
