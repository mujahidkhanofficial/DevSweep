import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { DetectedEnvironment } from '../../shared/src/disk.types.js';

const execAsync = promisify(exec);

export class EnvironmentDetector {
  public static async detectAll(): Promise<DetectedEnvironment[]> {
    const checks = [
      this.checkCommand('node', 'Node.js', 'node -v'),
      this.checkCommand('npm', 'npm', 'npm -v'),
      this.checkCommand('pnpm', 'pnpm', 'pnpm -v'),
      this.checkCommand('yarn', 'Yarn', 'yarn -v'),
      this.checkCommand('git', 'Git', 'git --version'),
      this.checkCommand('docker', 'Docker', 'docker --version'),
      this.checkCommand('flutter', 'Flutter', 'flutter --version'),
      this.checkGradle(),
      this.checkAndroidSdk(),
      this.checkVsCode()
    ];

    return Promise.all(checks);
  }

  private static async checkCommand(id: string, name: string, cmd: string): Promise<DetectedEnvironment> {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 2500 });
      return {
        id,
        name,
        detected: true,
        version: stdout.trim().split('\n')[0]
      };
    } catch {
      return { id, name, detected: false };
    }
  }

  private static async checkGradle(): Promise<DetectedEnvironment> {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    const gradleHome = process.env.GRADLE_USER_HOME || path.join(userProfile, '.gradle');
    try {
      await fs.promises.access(gradleHome);
      return { id: 'gradle', name: 'Gradle', detected: true, installPath: gradleHome };
    } catch {
      return { id: 'gradle', name: 'Gradle', detected: false };
    }
  }

  private static async checkAndroidSdk(): Promise<DetectedEnvironment> {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
    const candidatePaths = [
      process.env.ANDROID_HOME,
      process.env.ANDROID_SDK_ROOT,
      path.join(localAppData, 'Android', 'Sdk')
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      try {
        await fs.promises.access(p);
        return { id: 'android-sdk', name: 'Android SDK', detected: true, installPath: p };
      } catch {
        continue;
      }
    }

    return { id: 'android-sdk', name: 'Android SDK', detected: false };
  }

  private static async checkVsCode(): Promise<DetectedEnvironment> {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
    const appData = process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming';
    const candidatePaths = [
      path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(appData, 'Code')
    ];

    for (const p of candidatePaths) {
      try {
        await fs.promises.access(p);
        return { id: 'vscode', name: 'VS Code', detected: true, installPath: p };
      } catch {
        continue;
      }
    }

    return { id: 'vscode', name: 'VS Code', detected: false };
  }
}
