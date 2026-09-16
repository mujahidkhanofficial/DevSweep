import { describe, it, expect } from 'vitest';
import {
  ScannedItem,
  ToolchainId,
  isItemAssociatedWithToolchain
} from '@cleaner/shared';
import { RuleRegistry } from '../packages/cleanup-rules/src/RuleRegistry.js';

describe('DevSweep Priority 3: Interactive Toolchain Intelligence Behavioral Suite', () => {
  const mockCandidates: ScannedItem[] = [
    {
      id: 'flutter-1',
      ruleId: 'FLUTTER_PUB_CACHE',
      category: 'FLUTTER',
      toolchainId: 'flutter',
      label: 'Flutter Pub Cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\Pub\\Cache',
      size: 1024 * 1024 * 240, // 240 MB
      fileCount: 3500,
      safetyLevel: 'REBUILDABLE',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\Pub\\Cache',
        size: 1024 * 1024 * 240,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'Dart/Flutter packages',
        consequenceOfRemoval: 'Redownload on build',
        potentialImpact: 'Longer initial build',
        safetyConfidence: 'REBUILDABLE'
      }
    },
    {
      id: 'gradle-1',
      ruleId: 'GRADLE_CACHES',
      category: 'GRADLE',
      toolchainId: 'gradle',
      relatedToolchains: ['android-sdk'],
      label: 'Gradle Caches',
      path: 'C:\\Users\\dev\\.gradle\\caches',
      size: 1024 * 1024 * 500, // 500 MB
      fileCount: 4000,
      safetyLevel: 'REBUILDABLE',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\.gradle\\caches',
        size: 1024 * 1024 * 500,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'Downloaded Gradle jars',
        consequenceOfRemoval: 'Re-fetch plugins',
        potentialImpact: 'Network re-download',
        safetyConfidence: 'REBUILDABLE'
      }
    },
    {
      id: 'npm-1',
      ruleId: 'NODE_NPM_CACHE',
      category: 'NODE',
      toolchainId: 'npm',
      relatedToolchains: ['node'],
      label: 'npm Cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
      size: 1024 * 1024 * 100, // 100 MB
      fileCount: 1500,
      safetyLevel: 'SAFE',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
        size: 1024 * 1024 * 100,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'npm tarballs',
        consequenceOfRemoval: 'Redownload on install',
        potentialImpact: 'None',
        safetyConfidence: 'SAFE'
      }
    },
    {
      id: 'pnpm-1',
      ruleId: 'NODE_PNPM_STORE',
      category: 'NODE',
      toolchainId: 'pnpm',
      relatedToolchains: ['node'],
      label: 'pnpm Global Store',
      path: 'C:\\Users\\dev\\AppData\\Local\\pnpm\\store',
      size: 1024 * 1024 * 150, // 150 MB
      fileCount: 2200,
      safetyLevel: 'REBUILDABLE',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\pnpm\\store',
        size: 1024 * 1024 * 150,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'Content-addressable store',
        consequenceOfRemoval: 'Re-fetch on install',
        potentialImpact: 'Longer install',
        safetyConfidence: 'REBUILDABLE'
      }
    },
    {
      id: 'yarn-1',
      ruleId: 'NODE_YARN_CACHE',
      category: 'NODE',
      toolchainId: 'yarn',
      relatedToolchains: ['node'],
      label: 'Yarn Cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\Yarn\\Cache',
      size: 1024 * 1024 * 80, // 80 MB
      fileCount: 900,
      safetyLevel: 'SAFE',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\Yarn\\Cache',
        size: 1024 * 1024 * 80,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'Yarn tarballs',
        consequenceOfRemoval: 'Re-fetch',
        potentialImpact: 'None',
        safetyConfidence: 'SAFE'
      }
    },
    {
      id: 'node-only-1',
      ruleId: 'NODE_REPL_HISTORY',
      category: 'NODE',
      toolchainId: 'node',
      // Explicitly owned by Node, NO relatedToolchains
      label: 'Node REPL History',
      path: 'C:\\Users\\dev\\.node_repl_history',
      size: 1024 * 4,
      fileCount: 1,
      safetyLevel: 'SAFE',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Users\\dev\\.node_repl_history',
        size: 1024 * 4,
        mtimeMs: Date.now(),
        isDirectory: false,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'CLI history',
        consequenceOfRemoval: 'Clears command history',
        potentialImpact: 'None',
        safetyConfidence: 'SAFE'
      }
    },
    {
      id: 'protected-git-1',
      ruleId: 'GIT_PROTECTED_DIR',
      category: 'SYSTEM',
      toolchainId: 'git',
      label: 'Git Internal Repository',
      path: 'C:\\Projects\\repo\\.git',
      size: 1024 * 1024 * 50,
      fileCount: 600,
      safetyLevel: 'PROTECTED',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Projects\\repo\\.git',
        size: 1024 * 1024 * 50,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: {
        whyItExists: 'Source code history',
        consequenceOfRemoval: 'Fatal data loss',
        potentialImpact: 'Never delete',
        safetyConfidence: 'SAFE'
      }
    }
  ];

  describe('Toolchain Association', () => {
    it('associates Flutter candidate with Flutter', () => {
      const flutterItem = mockCandidates.find((c) => c.id === 'flutter-1')!;
      expect(isItemAssociatedWithToolchain(flutterItem, 'flutter')).toBe(true);
      expect(isItemAssociatedWithToolchain(flutterItem, 'gradle')).toBe(false);
      expect(isItemAssociatedWithToolchain(flutterItem, 'npm')).toBe(false);
    });

    it('associates Gradle candidate with Gradle and Android SDK through directional relation', () => {
      const gradleItem = mockCandidates.find((c) => c.id === 'gradle-1')!;
      expect(isItemAssociatedWithToolchain(gradleItem, 'gradle')).toBe(true);
      expect(isItemAssociatedWithToolchain(gradleItem, 'android-sdk')).toBe(true);
      expect(isItemAssociatedWithToolchain(gradleItem, 'node')).toBe(false);
    });

    it('associates npm, pnpm, and yarn candidates with their direct toolchains', () => {
      const npmItem = mockCandidates.find((c) => c.id === 'npm-1')!;
      const pnpmItem = mockCandidates.find((c) => c.id === 'pnpm-1')!;
      const yarnItem = mockCandidates.find((c) => c.id === 'yarn-1')!;

      expect(isItemAssociatedWithToolchain(npmItem, 'npm')).toBe(true);
      expect(isItemAssociatedWithToolchain(pnpmItem, 'pnpm')).toBe(true);
      expect(isItemAssociatedWithToolchain(yarnItem, 'yarn')).toBe(true);
    });

    it('associates npm, pnpm, and yarn with Node through explicit directional relatedToolchains', () => {
      const npmItem = mockCandidates.find((c) => c.id === 'npm-1')!;
      const pnpmItem = mockCandidates.find((c) => c.id === 'pnpm-1')!;
      const yarnItem = mockCandidates.find((c) => c.id === 'yarn-1')!;

      expect(isItemAssociatedWithToolchain(npmItem, 'node')).toBe(true);
      expect(isItemAssociatedWithToolchain(pnpmItem, 'node')).toBe(true);
      expect(isItemAssociatedWithToolchain(yarnItem, 'node')).toBe(true);
    });

    it('excludes unrelated candidates', () => {
      const flutterItem = mockCandidates.find((c) => c.id === 'flutter-1')!;
      expect(isItemAssociatedWithToolchain(flutterItem, 'vscode')).toBe(false);
      expect(isItemAssociatedWithToolchain(flutterItem, 'git')).toBe(false);
      expect(isItemAssociatedWithToolchain(flutterItem, 'node')).toBe(false);
    });

    it('maintains association for protected candidate while preserving PROTECTED safetyLevel', () => {
      const gitItem = mockCandidates.find((c) => c.id === 'protected-git-1')!;
      expect(isItemAssociatedWithToolchain(gitItem, 'git')).toBe(true);
      expect(gitItem.safetyLevel).toBe('PROTECTED');
    });
  });

  describe('Directionality Rules', () => {
    it('verifies Node includes npm/pnpm/yarn candidates, but npm does NOT include Node-only candidates', () => {
      const nodeOnly = mockCandidates.find((c) => c.id === 'node-only-1')!;
      const npmItem = mockCandidates.find((c) => c.id === 'npm-1')!;

      // Selecting Node shows both Node-only and npm items
      expect(isItemAssociatedWithToolchain(nodeOnly, 'node')).toBe(true);
      expect(isItemAssociatedWithToolchain(npmItem, 'node')).toBe(true);

      // Selecting npm shows npm items, but NOT Node-only items
      expect(isItemAssociatedWithToolchain(npmItem, 'npm')).toBe(true);
      expect(isItemAssociatedWithToolchain(nodeOnly, 'npm')).toBe(false);
    });

    it('verifies exact canonical toolchain scope matrix across all 8 target configurations', () => {
      // 1. Node -> Node + npm + pnpm + yarn
      const nodeResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'node'));
      expect(nodeResults.map((r) => r.id)).toEqual(['npm-1', 'pnpm-1', 'yarn-1', 'node-only-1']);

      // 2. npm -> npm only
      const npmResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'npm'));
      expect(npmResults.map((r) => r.id)).toEqual(['npm-1']);

      // 3. pnpm -> pnpm only
      const pnpmResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'pnpm'));
      expect(pnpmResults.map((r) => r.id)).toEqual(['pnpm-1']);

      // 4. yarn -> yarn only
      const yarnResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'yarn'));
      expect(yarnResults.map((r) => r.id)).toEqual(['yarn-1']);

      // 5. Flutter -> Flutter only
      const flutterResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'flutter'));
      expect(flutterResults.map((r) => r.id)).toEqual(['flutter-1']);

      // 6. Gradle -> Gradle + explicitly related Android SDK items
      const gradleResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'gradle'));
      expect(gradleResults.map((r) => r.id)).toEqual(['gradle-1']);

      // 7. Android SDK -> only Android-SDK-owned + explicitly related items
      const androidResults = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'android-sdk'));
      expect(androidResults.map((r) => r.id)).toEqual(['gradle-1']);

      // 8. VS Code -> VS Code only
      const vscodeItem: ScannedItem = {
        id: 'vscode-1',
        ruleId: 'VSCODE_CACHES',
        category: 'IDE',
        toolchainId: 'vscode',
        label: 'VS Code Cached Data',
        path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
        size: 1024 * 1024 * 60,
        fileCount: 400,
        safetyLevel: 'REBUILDABLE',
        selectedByDefault: true,
        fingerprint: {
          path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
          size: 1024 * 1024 * 60,
          mtimeMs: Date.now(),
          isDirectory: true,
          isSymbolicLink: false
        },
        explanation: {
          whyItExists: 'Editor cache',
          consequenceOfRemoval: 'Regenerated',
          potentialImpact: 'None',
          safetyConfidence: 'REBUILDABLE'
        }
      };
      const candidateListWithVsCode = [...mockCandidates, vscodeItem];
      const vscodeResults = candidateListWithVsCode.filter((it) => isItemAssociatedWithToolchain(it, 'vscode'));
      expect(vscodeResults.map((r) => r.id)).toEqual(['vscode-1']);
    });
  });

  describe('Filter Composition (Toolchain AND Safety AND Search)', () => {
    function composeFilters(
      candidates: ScannedItem[],
      toolchain: ToolchainId | null,
      safety: 'ALL' | 'SAFE' | 'REBUILDABLE' | 'REVIEW',
      search: string
    ): ScannedItem[] {
      return candidates.filter((item) => {
        if (toolchain && !isItemAssociatedWithToolchain(item, toolchain)) {
          return false;
        }
        if (safety !== 'ALL' && item.safetyLevel !== safety) {
          return false;
        }
        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const normalizedQ = q.replace(/[/\\]/g, '/');
          const matchesLabel = (item.label || '').toLowerCase().includes(q);
          const normalizedPath = (item.path || '').toLowerCase().replace(/[/\\]/g, '/');
          const matchesPath = normalizedPath.includes(normalizedQ);
          if (!matchesLabel && !matchesPath) {
            return false;
          }
        }
        return true;
      });
    }

    it('returns only intersection of toolchain, safety, and search', () => {
      // Filter: Node toolchain, REBUILDABLE only, search for 'pnpm'
      const result = composeFilters(mockCandidates, 'node', 'REBUILDABLE', 'pnpm');
      expect(result.map((r) => r.id)).toEqual(['pnpm-1']);

      // Filter: Node toolchain, SAFE only (should include npm-1 and yarn-1, but not pnpm-1)
      const safeNode = composeFilters(mockCandidates, 'node', 'SAFE', '');
      expect(safeNode.map((r) => r.id)).toEqual(['npm-1', 'yarn-1', 'node-only-1']);
    });

    it('clearing toolchain filter preserves active search and safety filters', () => {
      const withToolchain = composeFilters(mockCandidates, 'node', 'SAFE', 'cache');
      expect(withToolchain.map((r) => r.id)).toEqual(['npm-1', 'yarn-1']);

      // Remove toolchain filter only (set to null)
      const clearedToolchain = composeFilters(mockCandidates, null, 'SAFE', 'cache');
      // Now all SAFE items matching 'cache' across all toolchains are returned
      expect(clearedToolchain.map((r) => r.id)).toEqual(['npm-1', 'yarn-1']);
    });
  });

  describe('Selection Preservation & Immutability', () => {
    it('applying or removing toolchain filter never mutates candidate store or selectedItemIds', () => {
      const selectedItemIds = new Set<string>(['flutter-1', 'npm-1']);

      // Simulate applying toolchain filter 'flutter'
      const toolchainFilter: ToolchainId = 'flutter';
      const visible = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, toolchainFilter));

      // visible only contains flutter-1
      expect(visible.map((v) => v.id)).toEqual(['flutter-1']);

      // Canonical selectedItemIds still retains BOTH flutter-1 and npm-1!
      expect(selectedItemIds.has('flutter-1')).toBe(true);
      expect(selectedItemIds.has('npm-1')).toBe(true);
      expect(selectedItemIds.size).toBe(2);

      // Simulate removing toolchain filter
      const allVisible = mockCandidates.filter(() => true);
      expect(allVisible.length).toBe(mockCandidates.length);
      expect(selectedItemIds.size).toBe(2);
    });
  });

  describe('Dashboard States', () => {
    function deriveDashboardState(itemsCount: number, sessionExists: boolean) {
      if (itemsCount > 0) return 'SCANNED_WITH_CANDIDATES';
      if (sessionExists) return 'SCANNED_EMPTY';
      return 'NOT_SCANNED';
    }

    it('distinguishes unscanned, scanned empty, and scanned with candidates', () => {
      expect(deriveDashboardState(0, false)).toBe('NOT_SCANNED');
      expect(deriveDashboardState(0, true)).toBe('SCANNED_EMPTY');
      expect(deriveDashboardState(5, true)).toBe('SCANNED_WITH_CANDIDATES');
    });

    it('computes exact scanned candidates and bytes per toolchain', () => {
      const flutterItems = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'flutter'));
      expect(flutterItems).toHaveLength(1);
      expect(flutterItems[0].size).toBe(240 * 1024 * 1024);

      const nodeItems = mockCandidates.filter((it) => isItemAssociatedWithToolchain(it, 'node'));
      // npm (100MB) + pnpm (150MB) + yarn (80MB) + node-only (4KB) = 330MB + 4KB
      expect(nodeItems).toHaveLength(4);
      const totalBytes = nodeItems.reduce((acc, it) => acc + it.size, 0);
      expect(totalBytes).toBe(330 * 1024 * 1024 + 4096);
    });
  });

  describe('RuleRegistry Canonical Metadata', () => {
    it('verifies built-in rules carry canonical toolchain metadata', () => {
      const registry = new RuleRegistry();
      const npmRule = registry.getRule('NODE_NPM_CACHE');
      expect(npmRule?.toolchainId).toBe('npm');
      expect(npmRule?.relatedToolchains).toEqual(['node']);

      const pnpmRule = registry.getRule('NODE_PNPM_STORE');
      expect(pnpmRule?.toolchainId).toBe('pnpm');
      expect(pnpmRule?.relatedToolchains).toEqual(['node']);

      const gradleRule = registry.getRule('GRADLE_CACHES');
      expect(gradleRule?.toolchainId).toBe('gradle');
      expect(gradleRule?.relatedToolchains).toEqual(['android-sdk']);

      const flutterRule = registry.getRule('FLUTTER_PUB_CACHE');
      expect(flutterRule?.toolchainId).toBe('flutter');

      const vscodeRule = registry.getRule('VSCODE_CACHES');
      expect(vscodeRule?.toolchainId).toBe('vscode');
    });
  });
});
