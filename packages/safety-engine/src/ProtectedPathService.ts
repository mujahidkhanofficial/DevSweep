import path from 'path';
import fs from 'fs';
import { ProtectionLevel } from '../../shared/src/rules.types.js';

export interface ProtectionCheckResult {
  isProtected: boolean;
  tier?: ProtectionLevel;
  reason?: string;
}

export class ProtectedPathService {
  private userProtectedPaths: Set<string> = new Set();
  private systemProtectedRoots: string[] = [];

  // Sensitive directory names that should never be traversed or deleted
  private static readonly SENSITIVE_DIR_NAMES = new Set([
    '.git',
    '.svn',
    '.hg',
    '.ssh',
    '.gnupg',
    '.aws',
    '.azure',
    '.kube'
  ]);

  // Sensitive filename patterns (credentials, secrets, certificates)
  private static readonly SENSITIVE_FILE_PATTERNS = [
    /^\.env(\..+)?$/i,
    /^id_rsa.*$/i,
    /^id_ed25519.*$/i,
    /^id_ecdsa.*$/i,
    /.*\.(pem|key|keystore|pfx|p12|kdbx|asc)$/i,
    /^credentials(\..+)?$/i,
    /^secret(s)?\..+$/i
  ];

  constructor(customUserPaths: string[] = []) {
    this.initSystemPaths();
    for (const p of customUserPaths) {
      this.addUserProtectedPath(p);
    }
  }

  private initSystemPaths(): void {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    const windir = process.env.WINDIR || 'C:\\Windows';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programData = process.env.ProgramData || 'C:\\ProgramData';

    // System protected roots that cannot be touched
    this.systemProtectedRoots = [
      windir,
      programFiles,
      programFilesX86,
      programData,
      path.join(userProfile, 'Documents'),
      path.join(userProfile, 'Desktop'),
      path.join(userProfile, 'Pictures'),
      path.join(userProfile, 'Videos'),
      path.join(userProfile, 'Music'),
      path.join(userProfile, 'AppData', 'Roaming', 'Microsoft', 'Crypto'),
      path.join(userProfile, 'AppData', 'Roaming', 'Microsoft', 'Protect'),
      path.join(userProfile, 'AppData', 'Roaming', 'Microsoft', 'Credentials'),
      path.join(userProfile, '.ssh'),
      path.join(userProfile, '.gnupg'),
      path.join(userProfile, '.aws'),
      path.join(userProfile, '.azure'),
      path.join(userProfile, '.kube')
    ].map(p => this.normalize(p));
  }

  public addUserProtectedPath(userPath: string): void {
    const normalized = this.normalize(userPath);
    if (normalized) {
      this.userProtectedPaths.add(normalized);
    }
  }

  public removeUserProtectedPath(userPath: string): void {
    const normalized = this.normalize(userPath);
    if (normalized) {
      this.userProtectedPaths.delete(normalized);
    }
  }

  public getUserProtectedPaths(): string[] {
    return Array.from(this.userProtectedPaths);
  }

  public checkPath(candidatePath: string, allowedRuleRoot?: string): ProtectionCheckResult {
    const normalizedCandidate = this.normalize(candidatePath);
    if (!normalizedCandidate) {
      return { isProtected: true, tier: 'SYSTEM_PROTECTED', reason: 'Invalid or empty path' };
    }

    // 1. Check for semantic sensitive directories in the path segments
    const pathSegments = normalizedCandidate.split(/[\\/]/);
    for (const segment of pathSegments) {
      if (ProtectedPathService.SENSITIVE_DIR_NAMES.has(segment.toLowerCase())) {
        return {
          isProtected: true,
          tier: 'SYSTEM_PROTECTED',
          reason: `Path contains sensitive semantic directory segment: "${segment}"`
        };
      }
    }

    // 2. Check for sensitive file patterns
    const fileName = pathSegments[pathSegments.length - 1];
    for (const pattern of ProtectedPathService.SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(fileName)) {
        return {
          isProtected: true,
          tier: 'SYSTEM_PROTECTED',
          reason: `File "${fileName}" matches protected secret/credential pattern`
        };
      }
    }

    // 3. Check SYSTEM_PROTECTED roots
    for (const sysRoot of this.systemProtectedRoots) {
      if (this.isSameOrSubPath(normalizedCandidate, sysRoot)) {
        return {
          isProtected: true,
          tier: 'SYSTEM_PROTECTED',
          reason: `Location is within system protected root: "${sysRoot}"`
        };
      }
    }

    // 4. Check USER_PROTECTED locations
    for (const userRoot of this.userProtectedPaths) {
      if (this.isSameOrSubPath(normalizedCandidate, userRoot)) {
        return {
          isProtected: true,
          tier: 'USER_PROTECTED',
          reason: `Location is protected by user policy: "${userRoot}"`
        };
      }
    }

    // 5. Check RULE_PROTECTED (Strict containment within approved rule root)
    if (allowedRuleRoot) {
      const normalizedRuleRoot = this.normalize(allowedRuleRoot);
      if (!this.isStrictlyContained(normalizedCandidate, normalizedRuleRoot)) {
        return {
          isProtected: true,
          tier: 'RULE_PROTECTED',
          reason: `Path escaped the approved rule root "${normalizedRuleRoot}"`
        };
      }
    }

    return { isProtected: false };
  }

  public normalize(p: string): string {
    if (!p) return '';
    const resolved = path.resolve(p);
    return resolved.replace(/^[a-z]:/i, match => match.toUpperCase());
  }

  private isSameOrSubPath(candidate: string, protectedRoot: string): boolean {
    const rel = path.relative(protectedRoot, candidate);
    // If rel is empty, candidate == protectedRoot
    // If rel does not start with '..' and is not absolute, candidate is inside protectedRoot
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  public isStrictlyContained(candidate: string, parentRoot: string): boolean {
    const rel = path.relative(parentRoot, candidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
}
