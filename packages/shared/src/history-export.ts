import { CleanupTransaction, ToolchainId, SafetyLevel } from './rules.types.js';

export interface HistoryAuditRecord {
  timestamp: string;
  operation: 'CLEANUP' | 'DRY_RUN';
  ruleId: string;
  path: string;
  sizeBytes: number;
  result: 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'CANCELLED';
  failureReason: string;
  toolchain: string;
  safetyClassification: string;
}

export interface HistoryAuditJsonExport {
  schemaVersion: 1;
  application: 'DevSweep';
  exportedAt: string;
  recordCount: number;
  dateRange: {
    from: string | null;
    to: string | null;
  };
  records: HistoryAuditRecord[];
}

/**
 * Sanitizes untrusted text (such as file paths and error messages) to strictly prevent
 * leaking credentials, private keys, environment secret files, auth tokens, or specific
 * local user account names in audit logs.
 */
export function sanitizeAuditText(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let sanitized = input;

  // 1. Redact specific Windows/Unix user profile account names:
  // e.g. C:\Users\mujah\AppData\... -> C:\Users\[USER]\AppData\...
  // e.g. /home/mujah/... -> /home/[USER]/...
  sanitized = sanitized.replace(/([a-zA-Z]:[/\\]Users[/\\])([^/\\\s,;'"()]+)/gi, '$1[USER]');
  sanitized = sanitized.replace(/(\/home\/)([^/\\\s,;'"()]+)/gi, '$1[USER]');

  // 2. Redact environment secret files (.env, .env.local, .env.production, etc.)
  sanitized = sanitized.replace(/\.env(\.[\w.-]+)?\b/gi, '[REDACTED_ENV_FILE]');

  // 3. Redact private keys, certificate keys, and sensitive credential store filenames
  sanitized = sanitized.replace(
    /\b(id_rsa|id_dsa|id_ed25519|credentials\.json|secrets\.json|token\.json|[\w.-]+\.pem|[\w.-]+\.key)\b/gi,
    '[REDACTED_CREDENTIALS]'
  );

  // 4. Redact tokens, secrets, API keys, passwords embedded in URLs, query strings, or error messages
  sanitized = sanitized.replace(
    /\b(token|secret|password|api[_-]?key|auth|bearer)[=:][^\s,;'"\\/&]+/gi,
    '$1=[REDACTED]'
  );

  return sanitized;
}

/**
 * Converts historical CleanupTransactions into flat, auditable, sanitized records.
 * Prioritizes canonical metadata already stored on the transaction/items.
 * Strictly avoids secondary ruleId lookup tables or heuristic guesses.
 */
export function generateAuditRecords(transactions: CleanupTransaction[]): HistoryAuditRecord[] {
  const records: HistoryAuditRecord[] = [];

  for (const tx of transactions) {
    const timestamp = new Date(tx.startedAt).toISOString();
    const operation: 'CLEANUP' | 'DRY_RUN' = tx.dryRun ? 'DRY_RUN' : 'CLEANUP';

    // 1. If item-level records were recorded, export each item's verified audit record
    if (tx.items && tx.items.length > 0) {
      for (const item of tx.items) {
        records.push({
          timestamp,
          operation,
          ruleId: item.ruleId || tx.ruleId || 'Unspecified',
          path: sanitizeAuditText(item.path),
          sizeBytes: item.sizeBytes || 0,
          result: item.result,
          failureReason: sanitizeAuditText(item.failureReason || ''),
          toolchain: item.toolchainId || tx.toolchainId || 'Unspecified',
          safetyClassification: item.safetyLevel || tx.safetyLevel || 'Unspecified'
        });
      }
      continue;
    }

    // 2. Fallback for legacy transactions: extract skipped details and deleted totals
    if (tx.skippedDetails && tx.skippedDetails.length > 0) {
      for (const s of tx.skippedDetails) {
        const itemResult: 'SKIPPED' | 'FAILED' = tx.status === 'FAILED' ? 'FAILED' : 'SKIPPED';
        const reason = s.reason + (s.errorCode ? ` (${s.errorCode})` : '');
        records.push({
          timestamp,
          operation,
          ruleId: s.ruleId || tx.ruleId || 'Unspecified',
          path: sanitizeAuditText(s.path),
          sizeBytes: 0,
          result: itemResult,
          failureReason: sanitizeAuditText(reason),
          toolchain: s.toolchainId || tx.toolchainId || 'Unspecified',
          safetyClassification: s.safetyLevel || tx.safetyLevel || 'Unspecified'
        });
      }
    }

    if (tx.deletedCount > 0) {
      records.push({
        timestamp,
        operation,
        ruleId: tx.ruleId || 'Unspecified',
        path: sanitizeAuditText(tx.ruleId),
        sizeBytes: tx.bytesReclaimed || 0,
        result: 'SUCCESS',
        failureReason: '',
        toolchain: tx.toolchainId || 'Unspecified',
        safetyClassification: tx.safetyLevel || 'Unspecified'
      });
    } else if (!tx.skippedDetails || tx.skippedDetails.length === 0) {
      // Empty transaction that terminated before processing items
      records.push({
        timestamp,
        operation,
        ruleId: tx.ruleId || 'Unspecified',
        path: sanitizeAuditText(tx.ruleId),
        sizeBytes: 0,
        result: tx.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        failureReason: sanitizeAuditText(tx.status === 'CANCELLED' ? 'Operation cancelled by user' : 'Operation failed'),
        toolchain: tx.toolchainId || 'Unspecified',
        safetyClassification: tx.safetyLevel || 'Unspecified'
      });
    }
  }

  return records;
}

/**
 * Formats audit records into a standardized, versioned JSON export string.
 */
export function formatAuditAsJson(records: HistoryAuditRecord[]): string {
  let fromDate: string | null = null;
  let toDate: string | null = null;

  if (records.length > 0) {
    const timestamps = records.map((r) => r.timestamp).sort();
    fromDate = timestamps[0];
    toDate = timestamps[timestamps.length - 1];
  }

  const exportPayload: HistoryAuditJsonExport = {
    schemaVersion: 1,
    application: 'DevSweep',
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    dateRange: {
      from: fromDate,
      to: toDate
    },
    records
  };

  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Formats audit records into an RFC-4180 compliant CSV string with a stable header order,
 * CRLF line breaks, and proper double-quote escaping.
 */
export function formatAuditAsCsv(records: HistoryAuditRecord[]): string {
  const headers = [
    'timestamp',
    'operation',
    'ruleId',
    'path',
    'sizeBytes',
    'result',
    'failureReason',
    'toolchain',
    'safetyClassification'
  ];

  const escapeCsvField = (field: string | number): string => {
    const str = String(field ?? '');
    // Escape double quotes by doubling them: " -> ""
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const record of records) {
    const row = [
      escapeCsvField(record.timestamp),
      escapeCsvField(record.operation),
      escapeCsvField(record.ruleId),
      escapeCsvField(record.path),
      escapeCsvField(record.sizeBytes),
      escapeCsvField(record.result),
      escapeCsvField(record.failureReason),
      escapeCsvField(record.toolchain),
      escapeCsvField(record.safetyClassification)
    ];
    lines.push(row.join(','));
  }

  // RFC-4180 specifies CRLF (\r\n) line endings
  return lines.join('\r\n') + '\r\n';
}
