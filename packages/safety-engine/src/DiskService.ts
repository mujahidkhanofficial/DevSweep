import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DriveInfo } from '../../shared/src/disk.types.js';

const execAsync = promisify(exec);

export class DiskService {
  /**
   * Primary: Returns drive stats via native Node fs.promises.statfs (sub-millisecond)
   */
  public static async getDriveStats(driveLetter: string): Promise<DriveInfo | null> {
    const formatted = driveLetter.toUpperCase().replace(/[\\/]$/, '');
    const rootPath = `${formatted}\\`;

    try {
      const stat = await fs.promises.statfs(rootPath);
      const totalBytes = Number(stat.blocks) * Number(stat.bsize);
      const freeBytes = Number(stat.bfree) * Number(stat.bsize);
      const usedBytes = totalBytes - freeBytes;
      const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      return {
        caption: formatted,
        volumeName: '',
        totalBytes,
        freeBytes,
        usedBytes,
        percentUsed
      };
    } catch {
      return null;
    }
  }

  /**
   * Enumerates system drives using native probing + PowerShell Get-CimInstance fallback (No WMIC)
   */
  public static async getAllDrives(): Promise<DriveInfo[]> {
    const detected: DriveInfo[] = [];

    // 1. Try fast native probe on common Windows drive letters C..Z
    const candidateLetters = ['C', 'D', 'E', 'F', 'G'];
    for (const letter of candidateLetters) {
      const stats = await this.getDriveStats(`${letter}:`);
      if (stats && stats.totalBytes > 0) {
        detected.push(stats);
      }
    }

    if (detected.length > 0) {
      return detected;
    }

    // 2. Fallback to PowerShell Get-CimInstance (No WMIC)
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json"',
        { timeout: 4000 }
      );

      const parsed = JSON.parse(stdout.trim());
      const disks = Array.isArray(parsed) ? parsed : [parsed];

      for (const d of disks) {
        if (!d || !d.DeviceID || !d.Size) continue;
        const totalBytes = Number(d.Size);
        const freeBytes = Number(d.FreeSpace || 0);
        const usedBytes = totalBytes - freeBytes;
        const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

        detected.push({
          caption: d.DeviceID,
          volumeName: d.VolumeName || '',
          totalBytes,
          freeBytes,
          usedBytes,
          percentUsed
        });
      }
    } catch {
      // If fallback fails, return C: default if statfs worked
      const cStats = await this.getDriveStats('C:');
      if (cStats) detected.push(cStats);
    }

    return detected;
  }
}
