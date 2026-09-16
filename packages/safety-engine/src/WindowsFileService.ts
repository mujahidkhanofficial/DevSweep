import fs from 'fs';
import path from 'path';
import { NormalizedFsErrorCategory } from '../../shared/src/disk.types.js';

export interface FileOperationResult {
  success: boolean;
  bytes: number;
  errorCategory?: NormalizedFsErrorCategory;
  rawErrorCode?: string;
  errorMessage?: string;
}

export class WindowsFileService {
  /**
   * Normalizes platform filesystem errors into standard categories.
   */
  public static normalizeFsError(err: any): { category: NormalizedFsErrorCategory; reason: string } {
    const code = err?.code || '';
    const message = err?.message || String(err);

    if (code === 'EBUSY' || code === 'ETXTBSY' || message.includes('sharing violation') || message.includes('lock violation')) {
      return { category: 'FILE_IN_USE', reason: `File is in use by Windows or another running process (${code || 'EBUSY'})` };
    }
    if (code === 'EACCES') {
      return { category: 'ACCESS_DENIED', reason: `Access denied by Windows security policy (${code})` };
    }
    if (code === 'EPERM') {
      return { category: 'ACCESS_DENIED', reason: `Operation not permitted / access denied (${code})` };
    }
    if (code === 'ENOENT') {
      return { category: 'NOT_FOUND', reason: `Target file or directory not found (${code})` };
    }
    if (code === 'ENAMETOOLONG') {
      return { category: 'PATH_TOO_LONG', reason: `Path exceeds Windows length limits (${code})` };
    }
    if (code === 'EINVAL') {
      return { category: 'INVALID_PATH', reason: `Invalid filesystem path format (${code})` };
    }
    if (code === 'ENOTEMPTY') {
      return { category: 'FILE_IN_USE', reason: `Directory not empty; child files remain in use (${code})` };
    }

    return { category: 'UNKNOWN', reason: `Filesystem error: ${message}` };
  }

  public static normalizeError(err: any): { category: NormalizedFsErrorCategory; reason: string } {
    return this.normalizeFsError(err);
  }

  /**
   * Clears the Windows read-only attribute on a file.
   */
  public static async clearReadOnly(filePath: string): Promise<boolean> {
    try {
      await fs.promises.chmod(filePath, 0o666);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a path is a symbolic link or NTFS junction/reparse point without following it.
   */
  public static async isReparsePointOrSymlink(targetPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.lstat(targetPath);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  public static async isReparsePoint(targetPath: string): Promise<boolean> {
    return this.isReparsePointOrSymlink(targetPath);
  }

  /**
   * Safely deletes a file with Windows read-only attribute clearing and retry.
   * Does NOT execute shell commands.
   */
  public static async safeUnlinkFile(filePath: string): Promise<FileOperationResult> {
    try {
      const stats = await fs.promises.lstat(filePath);
      const fileSize = stats.size;

      try {
        await fs.promises.unlink(filePath);
        return { success: true, bytes: fileSize };
      } catch (firstErr: any) {
        // If EPERM or EACCES, attempt to clear Windows read-only attribute
        if (firstErr.code === 'EPERM' || firstErr.code === 'EACCES') {
          try {
            await fs.promises.chmod(filePath, 0o666);
            await fs.promises.unlink(filePath);
            return { success: true, bytes: fileSize };
          } catch (retryErr: any) {
            const normalized = this.normalizeFsError(retryErr);
            return {
              success: false,
              bytes: 0,
              errorCategory: normalized.category,
              rawErrorCode: retryErr.code,
              errorMessage: normalized.reason
            };
          }
        }

        const normalized = this.normalizeFsError(firstErr);
        return {
          success: false,
          bytes: 0,
          errorCategory: normalized.category,
          rawErrorCode: firstErr.code,
          errorMessage: normalized.reason
        };
      }
    } catch (lstatErr: any) {
      if (lstatErr.code === 'ENOENT') {
        // File already gone
        return { success: true, bytes: 0 };
      }
      const normalized = this.normalizeFsError(lstatErr);
      return {
        success: false,
        bytes: 0,
        errorCategory: normalized.category,
        rawErrorCode: lstatErr.code,
        errorMessage: normalized.reason
      };
    }
  }

  /**
   * Safely removes a directory junction or empty directory.
   */
  public static async safeRemoveEmptyDirectory(dirPath: string): Promise<FileOperationResult> {
    try {
      await fs.promises.rmdir(dirPath);
      return { success: true, bytes: 0 };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { success: true, bytes: 0 };
      }
      const normalized = this.normalizeFsError(err);
      return {
        success: false,
        bytes: 0,
        errorCategory: normalized.category,
        rawErrorCode: err.code,
        errorMessage: normalized.reason
      };
    }
  }

  /**
   * Unlinks a symlink or junction reparse point without following it into its target.
   */
  public static async safeUnlinkReparsePoint(reparsePath: string): Promise<FileOperationResult> {
    try {
      const stats = await fs.promises.lstat(reparsePath);
      await fs.promises.unlink(reparsePath);
      return { success: true, bytes: stats.size };
    } catch (err: any) {
      if (err.code === 'EPERM' || err.code === 'EISDIR') {
        // On Windows, directory junctions may require rmdir to unlink the junction pointer
        try {
          await fs.promises.rmdir(reparsePath);
          return { success: true, bytes: 0 };
        } catch (rmdirErr: any) {
          const normalized = this.normalizeFsError(rmdirErr);
          return {
            success: false,
            bytes: 0,
            errorCategory: normalized.category,
            rawErrorCode: rmdirErr.code,
            errorMessage: normalized.reason
          };
        }
      }
      const normalized = this.normalizeFsError(err);
      return {
        success: false,
        bytes: 0,
        errorCategory: normalized.category,
        rawErrorCode: err.code,
        errorMessage: normalized.reason
      };
    }
  }

  public static async forceDeleteFile(filePath: string): Promise<FileOperationResult> {
    return this.safeUnlinkFile(filePath);
  }

  public static async forceDeleteReparsePoint(reparsePath: string): Promise<FileOperationResult> {
    return this.safeUnlinkReparsePoint(reparsePath);
  }
}
