import { describe, it, expect } from 'vitest';
import {
  sanitizeAuditText,
  generateAuditRecords,
  formatAuditAsJson,
  formatAuditAsCsv,
  CleanupTransaction,
  HistoryAuditJsonExport
} from '../packages/shared/src/index.js';

function createMockTx(overrides: Partial<CleanupTransaction>): CleanupTransaction {
  return {
    transactionId: overrides.transactionId || 'tx-default',
    scanSessionId: overrides.scanSessionId || 'session-default',
    ruleId: overrides.ruleId || 'NODE_NPM_CACHE',
    startedAt: overrides.startedAt || 1700000000000,
    completedAt: overrides.completedAt || 1700000001000,
    status: overrides.status || 'COMPLETED',
    totalRequested: overrides.totalRequested || 1,
    validatedCount: overrides.validatedCount || 1,
    deletedCount: overrides.deletedCount || 1,
    skippedCount: overrides.skippedCount || 0,
    failedCount: overrides.failedCount || 0,
    timedOutCount: overrides.timedOutCount || 0,
    cancelledCount: overrides.cancelledCount || 0,
    bytesReclaimed: overrides.bytesReclaimed || 1024,
    dryRun: overrides.dryRun ?? false,
    skippedDetails: overrides.skippedDetails || [],
    items: overrides.items,
    toolchainId: overrides.toolchainId,
    relatedToolchains: overrides.relatedToolchains,
    safetyLevel: overrides.safetyLevel
  };
}

describe('Priority 4.4 — History Audit Export & Sanitization', () => {
  describe('sanitizeAuditText — Privacy and Secrets Protection', () => {
    it('redacts local user account names from Windows and Unix file paths', () => {
      const windowsPath = 'C:\\Users\\mujah\\AppData\\Local\\npm-cache\\_cacache\\index-v5\\0a';
      const sanitizedWin = sanitizeAuditText(windowsPath);
      expect(sanitizedWin).toBe('C:\\Users\\[USER]\\AppData\\Local\\npm-cache\\_cacache\\index-v5\\0a');
      expect(sanitizedWin).not.toContain('mujah');

      const unixPath = '/home/johndoe/.gradle/caches/modules-2';
      const sanitizedUnix = sanitizeAuditText(unixPath);
      expect(sanitizedUnix).toBe('/home/[USER]/.gradle/caches/modules-2');
      expect(sanitizedUnix).not.toContain('johndoe');
    });

    it('redacts .env files and environment secret files', () => {
      expect(sanitizeAuditText('C:\\Projects\\app\\.env')).toBe('C:\\Projects\\app\\[REDACTED_ENV_FILE]');
      expect(sanitizeAuditText('C:\\Projects\\app\\.env.local')).toBe('C:\\Projects\\app\\[REDACTED_ENV_FILE]');
      expect(sanitizeAuditText('C:\\Projects\\app\\.env.production')).toBe('C:\\Projects\\app\\[REDACTED_ENV_FILE]');
      expect(sanitizeAuditText('C:\\Projects\\app\\.env.staging.backup')).toBe('C:\\Projects\\app\\[REDACTED_ENV_FILE]');
    });

    it('redacts SSH keys, PEM certs, credentials.json, and secrets.json', () => {
      expect(sanitizeAuditText('C:\\Users\\alice\\.ssh\\id_rsa')).toBe('C:\\Users\\[USER]\\.ssh\\[REDACTED_CREDENTIALS]');
      expect(sanitizeAuditText('C:\\Users\\alice\\.ssh\\id_ed25519')).toBe('C:\\Users\\[USER]\\.ssh\\[REDACTED_CREDENTIALS]');
      expect(sanitizeAuditText('C:\\vault\\credentials.json')).toBe('C:\\vault\\[REDACTED_CREDENTIALS]');
      expect(sanitizeAuditText('C:\\vault\\secrets.json')).toBe('C:\\vault\\[REDACTED_CREDENTIALS]');
      expect(sanitizeAuditText('C:\\certs\\server.pem')).toBe('C:\\certs\\[REDACTED_CREDENTIALS]');
      expect(sanitizeAuditText('C:\\certs\\private.key')).toBe('C:\\certs\\[REDACTED_CREDENTIALS]');
    });

    it('redacts embedded tokens, passwords, and API keys from error messages and query strings', () => {
      const errorMsg = 'EPERM: failed to connect with token=ghp_ABC123secretXYZ to remote cache';
      const sanitized = sanitizeAuditText(errorMsg);
      expect(sanitized).toBe('EPERM: failed to connect with token=[REDACTED] to remote cache');
      expect(sanitized).not.toContain('ghp_ABC123secretXYZ');

      const apiKeyErr = 'Access denied: api_key=AIzaSyD-123456789 secret=SUPERSECRET';
      const sanitizedApi = sanitizeAuditText(apiKeyErr);
      expect(sanitizedApi).toContain('api_key=[REDACTED]');
      expect(sanitizedApi).toContain('secret=[REDACTED]');
      expect(sanitizedApi).not.toContain('AIzaSyD-123456789');
      expect(sanitizedApi).not.toContain('SUPERSECRET');
    });

    it('redacts secrets from failureReason as well as path (Bi-directional Leakage Prevention)', () => {
      const leakInFailureReason = 'EPERM: C:\\Users\\mujahid\\project\\.env.production is locked by process token=98765';
      const sanitized = sanitizeAuditText(leakInFailureReason);
      expect(sanitized).not.toContain('mujahid');
      expect(sanitized).not.toContain('.env.production');
      expect(sanitized).not.toContain('98765');
      expect(sanitized).toBe('EPERM: C:\\Users\\[USER]\\project\\[REDACTED_ENV_FILE] is locked by process token=[REDACTED]');
    });
  });

  describe('generateAuditRecords — Canonical Metadata & Item-Level Result Fidelity', () => {
    it('consumes persisted canonical metadata without secondary lookup tables', () => {
      const mockTx = createMockTx({
        transactionId: 'tx-1001',
        ruleId: 'NODE_NPM_CACHE',
        startedAt: 1700000000000,
        completedAt: 1700000005000,
        status: 'COMPLETED',
        deletedCount: 2,
        skippedCount: 0,
        bytesReclaimed: 2048,
        dryRun: false,
        skippedDetails: [],
        toolchainId: 'npm',
        safetyLevel: 'SAFE',
        items: [
          {
            itemId: 'item-1',
            ruleId: 'NODE_NPM_CACHE',
            path: 'C:\\Users\\mujah\\AppData\\Local\\npm-cache\\item1',
            sizeBytes: 1024,
            result: 'SUCCESS',
            toolchainId: 'npm',
            safetyLevel: 'SAFE'
          },
          {
            itemId: 'item-2',
            ruleId: 'NODE_NPM_CACHE',
            path: 'C:\\Users\\mujah\\AppData\\Local\\npm-cache\\item2',
            sizeBytes: 1024,
            result: 'SUCCESS',
            toolchainId: 'npm',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const records = generateAuditRecords([mockTx]);
      expect(records).toHaveLength(2);
      expect(records[0].toolchain).toBe('npm');
      expect(records[0].safetyClassification).toBe('SAFE');
      expect(records[0].result).toBe('SUCCESS');
      expect(records[0].path).toBe('C:\\Users\\[USER]\\AppData\\Local\\npm-cache\\item1');
    });

    it('faithfully decomposes partial transactions into individual item-level SUCCESS and SKIPPED/FAILED results', () => {
      const partialTx = createMockTx({
        transactionId: 'tx-1002',
        ruleId: 'GRADLE_CACHES',
        startedAt: 1700000010000,
        completedAt: 1700000015000,
        status: 'PARTIAL',
        deletedCount: 2,
        skippedCount: 1,
        bytesReclaimed: 50000,
        dryRun: false,
        skippedDetails: [
          {
            path: 'C:\\Users\\mujah\\.gradle\\caches\\locked.bin',
            reason: 'File in use by java.exe',
            errorCode: 'EBUSY',
            toolchainId: 'gradle',
            safetyLevel: 'SAFE'
          }
        ],
        toolchainId: 'gradle',
        safetyLevel: 'SAFE',
        items: [
          {
            itemId: 'g-1',
            ruleId: 'GRADLE_CACHES',
            path: 'C:\\Users\\mujah\\.gradle\\caches\\transforms',
            sizeBytes: 25000,
            result: 'SUCCESS',
            toolchainId: 'gradle',
            safetyLevel: 'SAFE'
          },
          {
            itemId: 'g-2',
            ruleId: 'GRADLE_CACHES',
            path: 'C:\\Users\\mujah\\.gradle\\caches\\jars',
            sizeBytes: 25000,
            result: 'SUCCESS',
            toolchainId: 'gradle',
            safetyLevel: 'SAFE'
          },
          {
            itemId: 'g-3',
            ruleId: 'GRADLE_CACHES',
            path: 'C:\\Users\\mujah\\.gradle\\caches\\locked.bin',
            sizeBytes: 500,
            result: 'FAILED',
            failureReason: 'EBUSY: file is locked by gradle daemon token=secret123',
            toolchainId: 'gradle',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const records = generateAuditRecords([partialTx]);
      expect(records).toHaveLength(3);

      // Verify the transaction-level 'PARTIAL' status did NOT overwrite individual item statuses
      expect(records[0].result).toBe('SUCCESS');
      expect(records[1].result).toBe('SUCCESS');
      expect(records[2].result).toBe('FAILED');

      // Check failureReason redaction on the failed item
      expect(records[2].failureReason).toContain('token=[REDACTED]');
      expect(records[2].failureReason).not.toContain('secret123');
      expect(records[2].path).toBe('C:\\Users\\[USER]\\.gradle\\caches\\locked.bin');
    });

    it('marks dry run transactions as DRY_RUN operation without conflating it with results', () => {
      const dryRunTx = createMockTx({
        transactionId: 'tx-dry',
        ruleId: 'VSCODE_WORKSPACE_STORAGE',
        startedAt: 1700000020000,
        completedAt: 1700000021000,
        status: 'COMPLETED',
        deletedCount: 1,
        skippedCount: 0,
        bytesReclaimed: 120000,
        dryRun: true,
        skippedDetails: [],
        toolchainId: 'vscode',
        safetyLevel: 'SAFE',
        items: [
          {
            itemId: 'vs-1',
            ruleId: 'VSCODE_WORKSPACE_STORAGE',
            path: 'C:\\Users\\mujah\\AppData\\Roaming\\Code\\User\\workspaceStorage\\abc',
            sizeBytes: 120000,
            result: 'SUCCESS',
            toolchainId: 'vscode',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const records = generateAuditRecords([dryRunTx]);
      expect(records).toHaveLength(1);
      expect(records[0].operation).toBe('DRY_RUN');
      expect(records[0].result).toBe('SUCCESS');
      expect(records[0].toolchain).toBe('vscode');
    });
  });

  describe('formatAuditAsJson — Versioned Schema & Integrity', () => {
    it('produces valid JSON conforming to version 1 schema with explicit record count and dateRange', () => {
      const tx1 = createMockTx({
        transactionId: 'tx-1',
        ruleId: 'NODE_NPM_CACHE',
        startedAt: 1700000000000,
        completedAt: 1700000001000,
        status: 'COMPLETED',
        deletedCount: 1,
        skippedCount: 0,
        bytesReclaimed: 100,
        dryRun: false,
        skippedDetails: [],
        items: [
          {
            itemId: 'i-1',
            ruleId: 'NODE_NPM_CACHE',
            path: 'C:\\Users\\dev\\cache',
            sizeBytes: 100,
            result: 'SUCCESS',
            toolchainId: 'npm',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const records = generateAuditRecords([tx1]);
      const jsonString = formatAuditAsJson(records);
      const parsed: HistoryAuditJsonExport = JSON.parse(jsonString);

      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.application).toBe('DevSweep');
      expect(typeof parsed.exportedAt).toBe('string');
      expect(parsed.recordCount).toBe(1);
      expect(parsed.dateRange.from).toBe('2023-11-14T22:13:20.000Z');
      expect(parsed.dateRange.to).toBe('2023-11-14T22:13:20.000Z');
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].path).toBe('C:\\Users\\[USER]\\cache');
    });
  });

  describe('formatAuditAsCsv — RFC-4180 Compliance & Stable Headers', () => {
    it('formats records into RFC-4180 compliant CSV with exact header, CRLF line endings, and double quotes', () => {
      const tx = createMockTx({
        transactionId: 'tx-csv',
        ruleId: 'GIT_LOCAL_STATUS',
        startedAt: 1700000000000,
        completedAt: 1700000002000,
        status: 'COMPLETED',
        deletedCount: 1,
        skippedCount: 0,
        bytesReclaimed: 500,
        dryRun: false,
        skippedDetails: [],
        items: [
          {
            itemId: 'git-1',
            ruleId: 'GIT_LOCAL_STATUS',
            path: 'C:\\Users\\dev\\.git\\objects\\pack\\file "with quotes"',
            sizeBytes: 500,
            result: 'SUCCESS',
            toolchainId: 'git',
            safetyLevel: 'SAFE'
          }
        ]
      });

      const records = generateAuditRecords([tx]);
      const csv = formatAuditAsCsv(records);

      // Verify CRLF (\r\n) line endings
      expect(csv).toContain('\r\n');

      const lines = csv.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);

      // Verify exact stable header line
      expect(lines[0]).toBe(
        'timestamp,operation,ruleId,path,sizeBytes,result,failureReason,toolchain,safetyClassification'
      );

      // Verify double-quote escaping for values with quotes
      expect(lines[1]).toContain('""with quotes""');
      expect(lines[1]).toContain('"C:\\Users\\[USER]\\.git\\objects\\pack\\file ""with quotes"""');
      expect(lines[1]).toContain('"git"');
      expect(lines[1]).toContain('"SAFE"');
    });
  });
});
