import { describe, it, expect } from 'vitest';
import {
  diagnoseLockedFiles,
  getRetryCandidateIds,
  ScannedItem,
  CleanupTransaction
} from '@cleaner/shared';

describe('Priority 4.2 — Locked-File Remediation Guidance', () => {
  const createMockItem = (overrides: Partial<ScannedItem> & { id: string; path: string }): ScannedItem => ({
    label: overrides.id,
    size: 1024 * 1024 * 50,
    fileCount: 100,
    safetyLevel: 'SAFE',
    category: 'GENERAL',
    ruleId: 'general-rule',
    selectedByDefault: true,
    fingerprint: {
      path: overrides.path,
      size: 1024 * 1024 * 50,
      mtimeMs: 1000,
      isDirectory: true,
      isSymbolicLink: false
    },
    explanation: {
      whyItExists: 'Generated test cache',
      consequenceOfRemoval: 'Will be recreated',
      potentialImpact: 'Minimal',
      safetyConfidence: 'SAFE'
    },
    ...overrides
  });

  const sampleScannedItems: ScannedItem[] = [
    createMockItem({
      id: 'item-node-cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
      label: 'npm Cache',
      category: 'NODE',
      ruleId: 'npm-cache',
      toolchainId: 'npm',
      relatedToolchains: ['node']
    }),
    createMockItem({
      id: 'item-gradle-cache',
      path: 'C:\\Users\\dev\\.gradle\\caches',
      label: 'Gradle Caches',
      safetyLevel: 'REBUILDABLE',
      category: 'GRADLE',
      ruleId: 'gradle-caches',
      toolchainId: 'gradle',
      relatedToolchains: ['android-sdk']
    }),
    createMockItem({
      id: 'item-vscode-cache',
      path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
      label: 'VS Code Cache',
      category: 'IDE',
      ruleId: 'vscode-cache',
      toolchainId: 'vscode'
    }),
    createMockItem({
      id: 'item-temp-file',
      path: 'C:\\Users\\dev\\AppData\\Local\\Temp\\build_temp',
      label: 'Windows Temp',
      safetyLevel: 'REVIEW',
      category: 'SYSTEM',
      ruleId: 'system-temp'
    })
  ];

  describe('1. Canonical Toolchain Diagnosis', () => {
    it('uses canonical toolchainId from ScannedItem over path guessing', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\.gradle\\caches',
          reason: 'EBUSY: resource busy or locked',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, sampleScannedItems);

      expect(diagnosis.failedCount).toBe(1);
      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('Gradle / Java');
      expect(diagnosis.likelyProcesses).toContain('Gradle / Java');
      expect(diagnosis.advisoryMessage).toContain('Gradle / Java may currently be using these file');
      // Must remain advisory, never claim absolute certainty
      expect(diagnosis.advisoryMessage).toContain('Possible cause:');
    });

    it('diagnoses canonical npm toolchain with Node.js association', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
          reason: 'file locked',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, sampleScannedItems);

      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('npm / Node.js');
      expect(diagnosis.likelyProcesses).toContain('npm / Node.js');
    });

    it('diagnoses canonical VS Code toolchain', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
          reason: 'EPERM: operation not permitted',
          errorCode: 'EPERM'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, sampleScannedItems);

      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('Visual Studio Code');
      expect(diagnosis.likelyProcesses).toContain('Visual Studio Code');
    });

    it('canonical metadata strictly beats conflicting path heuristic strings', () => {
      // Path has 'node_modules' in it, but canonical toolchain is explicitly 'gradle'
      const conflictingItem = createMockItem({
        id: 'item-gradle-with-node-text',
        path: 'C:\\Users\\dev\\.gradle\\caches\\node_modules_wrapper',
        category: 'GRADLE',
        ruleId: 'gradle-caches',
        toolchainId: 'gradle'
      });

      const skipped = [
        {
          path: 'C:\\Users\\dev\\.gradle\\caches\\node_modules_wrapper\\file.lock',
          reason: 'EBUSY: locked',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, [conflictingItem]);

      // MUST be CANONICAL and Gradle, NEVER heuristic Node.js
      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('Gradle / Java');
      expect(diagnosis.likelyProcesses).not.toContain('Node.js / npm');
    });

    it('inherits canonical toolchain for nested child files inside scanned candidate directory', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\.gradle\\caches\\modules-2\\files-2.1\\org.slf4j\\slf4j.jar',
          reason: 'EBUSY: locked by gradle daemon',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, sampleScannedItems);

      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('Gradle / Java');
    });

    it('respects direct detail.toolchainId when provided explicitly on skipped detail', () => {
      const skipped = [
        {
          path: 'Z:\\CustomBuild\\artifact.zip',
          reason: 'EBUSY: locked',
          errorCode: 'EBUSY',
          toolchainId: 'docker' as const
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, []);

      expect(diagnosis.items[0].source).toBe('CANONICAL');
      expect(diagnosis.items[0].suggestedProcess).toBe('Docker Desktop');
    });
  });

  describe('2. Fallback Path-Based Diagnosis', () => {
    it('infers process from path when canonical metadata is absent', () => {
      const skipped = [
        {
          path: 'D:\\RandomDrive\\.gradle\\caches\\modules-2\\metadata.bin',
          reason: 'locked by process',
          errorCode: 'EBUSY'
        }
      ];

      // No scanned items passed
      const diagnosis = diagnoseLockedFiles(skipped, []);

      expect(diagnosis.items[0].source).toBe('HEURISTIC');
      expect(diagnosis.items[0].suggestedProcess).toBe('Gradle / Java');
      expect(diagnosis.likelyProcesses).toContain('Gradle / Java');
    });

    it('infers Node.js / npm from node_modules path', () => {
      const skipped = [
        {
          path: 'C:\\Projects\\my-app\\node_modules\\.bin\\tsc.exe',
          reason: 'resource busy',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, []);

      expect(diagnosis.items[0].source).toBe('HEURISTIC');
      expect(diagnosis.items[0].suggestedProcess).toBe('Node.js / npm');
    });

    it('infers Flutter / Dart from pub-cache path', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\AppData\\Local\\Pub\\Cache\\hosted\\pub.dev\\archive.lock',
          reason: 'access denied',
          errorCode: 'EACCES'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, []);

      expect(diagnosis.items[0].source).toBe('HEURISTIC');
      expect(diagnosis.items[0].suggestedProcess).toBe('Flutter / Dart');
    });
  });

  describe('3. Unknown Path Diagnosis', () => {
    it('gracefully classifies unrecognized paths as UNKNOWN without crashing', () => {
      const skipped = [
        {
          path: 'E:\\unregistered\\custom_data\\archive.xyz',
          reason: 'file locked',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, []);

      expect(diagnosis.items[0].source).toBe('UNKNOWN');
      expect(diagnosis.items[0].suggestedProcess).toBe('Unknown process or background task');
      expect(diagnosis.advisoryMessage).toContain('A background application or Windows service may currently have a lock');
    });
  });

  describe('4. Windows Error Code Interpretation', () => {
    it('explains EBUSY as actively locked', () => {
      const skipped = [
        {
          path: 'C:\\test\\file.lock',
          reason: 'EBUSY: resource busy or locked',
          errorCode: 'EBUSY'
        }
      ];
      const diagnosis = diagnoseLockedFiles(skipped, []);
      expect(diagnosis.items[0].advisoryNote).toContain('actively locked by another running process (EBUSY)');
    });

    it('explains EPERM as operation not permitted / read-only', () => {
      const skipped = [
        {
          path: 'C:\\test\\readonly.bin',
          reason: 'EPERM: operation not permitted',
          errorCode: 'EPERM'
        }
      ];
      const diagnosis = diagnoseLockedFiles(skipped, []);
      expect(diagnosis.items[0].advisoryNote).toContain('Operation not permitted (EPERM)');
    });

    it('explains EACCES as access denied', () => {
      const skipped = [
        {
          path: 'C:\\test\\protected.dat',
          reason: 'EACCES: access is denied',
          errorCode: 'EACCES'
        }
      ];
      const diagnosis = diagnoseLockedFiles(skipped, []);
      expect(diagnosis.items[0].advisoryNote).toContain('Access denied (EACCES)');
    });
  });

  describe('5. Mixed Toolchain Aggregation', () => {
    it('combines multiple distinct toolchains cleanly into advisory message', () => {
      const skipped = [
        {
          path: 'C:\\Users\\dev\\.gradle\\caches',
          reason: 'EBUSY',
          errorCode: 'EBUSY'
        },
        {
          path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
          reason: 'EBUSY',
          errorCode: 'EBUSY'
        },
        {
          path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
          reason: 'EBUSY',
          errorCode: 'EBUSY'
        }
      ];

      const diagnosis = diagnoseLockedFiles(skipped, sampleScannedItems);

      expect(diagnosis.failedCount).toBe(3);
      expect(diagnosis.likelyProcesses).toHaveLength(3);
      expect(diagnosis.likelyProcesses).toContain('Gradle / Java');
      expect(diagnosis.likelyProcesses).toContain('npm / Node.js');
      expect(diagnosis.likelyProcesses).toContain('Visual Studio Code');
      expect(diagnosis.advisoryMessage).toContain('Possible cause:');
      expect(diagnosis.advisoryMessage).toContain('Gradle / Java');
      expect(diagnosis.advisoryMessage).toContain('npm / Node.js');
      expect(diagnosis.advisoryMessage).toContain('Visual Studio Code');
      expect(diagnosis.advisoryMessage).toContain('may currently be using these files.');
    });
  });

  describe('6. Retry Candidate Isolation & Exclusions', () => {
    const mockTx: CleanupTransaction = {
      transactionId: 'tx-retry-test',
      scanSessionId: 'session-retry',
      ruleId: 'npm-cache',
      status: 'PARTIAL',
      dryRun: false,
      startedAt: 1000,
      completedAt: 2000,
      totalRequested: 4,
      validatedCount: 4,
      deletedCount: 2,
      skippedCount: 2,
      failedCount: 0,
      timedOutCount: 0,
      cancelledCount: 0,
      bytesReclaimed: 1024 * 1024 * 100,
      skippedDetails: [
        {
          path: 'C:\\Users\\dev\\.gradle\\caches',
          reason: 'EBUSY: locked',
          errorCode: 'EBUSY'
        },
        {
          path: 'C:\\Users\\dev\\AppData\\Roaming\\Code\\Cache',
          reason: 'EPERM: locked',
          errorCode: 'EPERM'
        }
      ]
    };

    it('extracts only failed/unremoved item IDs from the immediately preceding cleanup', () => {
      const retryIds = getRetryCandidateIds(mockTx, sampleScannedItems);

      expect(retryIds).toHaveLength(2);
      expect(retryIds).toContain('item-gradle-cache');
      expect(retryIds).toContain('item-vscode-cache');
    });

    it('isolates candidate ID when only a nested child file inside it was skipped', () => {
      const nestedTx: CleanupTransaction = {
        ...mockTx,
        skippedDetails: [
          {
            path: 'C:\\Users\\dev\\.gradle\\caches\\modules-2\\files-2.1\\locked_file.lock',
            reason: 'EBUSY: locked',
            errorCode: 'EBUSY'
          }
        ]
      };

      const retryIds = getRetryCandidateIds(nestedTx, sampleScannedItems);

      expect(retryIds).toEqual(['item-gradle-cache']);
      expect(retryIds).not.toContain('item-node-cache');
      expect(retryIds).not.toContain('item-vscode-cache');
    });

    it('strictly excludes successfully deleted items from retry', () => {
      const retryIds = getRetryCandidateIds(mockTx, sampleScannedItems);

      expect(retryIds).not.toContain('item-node-cache');
      expect(retryIds).not.toContain('item-temp-file');
    });

    it('returns empty array when transaction has zero skipped items', () => {
      const cleanTx: CleanupTransaction = {
        ...mockTx,
        status: 'COMPLETED',
        deletedCount: 4,
        skippedCount: 0,
        skippedDetails: []
      };

      const retryIds = getRetryCandidateIds(cleanTx, sampleScannedItems);
      expect(retryIds).toEqual([]);
    });

    it('never auto-selects additional candidates during retry', () => {
      const extraItems: ScannedItem[] = [
        ...sampleScannedItems,
        createMockItem({
          id: 'item-extra-unrelated',
          path: 'C:\\Users\\dev\\AppData\\Local\\pip\\cache',
          label: 'pip Cache',
          category: 'GENERAL',
          ruleId: 'pip-cache'
        })
      ];

      const retryIds = getRetryCandidateIds(mockTx, extraItems);
      expect(retryIds).not.toContain('item-extra-unrelated');
    });
  });

  describe('7. Safety Invariants', () => {
    it('preserves item safety classifications across retry', () => {
      const retryIds = getRetryCandidateIds(
        {
          transactionId: 'tx-1',
          scanSessionId: 'sess-1',
          ruleId: 'rule-1',
          status: 'PARTIAL',
          dryRun: false,
          startedAt: 1,
          totalRequested: 1,
          validatedCount: 1,
          deletedCount: 0,
          skippedCount: 1,
          failedCount: 0,
          timedOutCount: 0,
          cancelledCount: 0,
          bytesReclaimed: 0,
          skippedDetails: [{ path: 'C:\\Users\\dev\\.gradle\\caches', reason: 'locked' }]
        },
        sampleScannedItems
      );

      const target = sampleScannedItems.find((i) => i.id === retryIds[0]);
      expect(target?.safetyLevel).toBe('REBUILDABLE');
    });
  });
});
