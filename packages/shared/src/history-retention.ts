import { CleanupTransaction } from './rules.types.js';

export interface HistoryRetentionConfig {
  /** Maximum number of records to retain. 0 means unlimited. */
  maxRecords: number;
  /** Maximum age of records to retain in days. 0 means unlimited. */
  maxAgeDays: number;
  /** Whether to automatically prune history when a cleanup transaction completes and is saved. */
  autoPruneOnSave: boolean;
}

export const DEFAULT_RETENTION_CONFIG: HistoryRetentionConfig = {
  maxRecords: 100,
  maxAgeDays: 90,
  autoPruneOnSave: true
};

export interface ValidationResult<T> {
  valid: boolean;
  error?: string;
  config?: T;
}

/**
 * Validates retention policy settings with strict checks against negative, fractional,
 * NaN, Infinity, and non-integer values.
 */
export function validateRetentionConfig(input: unknown): ValidationResult<HistoryRetentionConfig> {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Retention configuration must be an object' };
  }

  const candidate = input as Record<string, unknown>;

  if (
    typeof candidate.maxRecords !== 'number' ||
    !Number.isInteger(candidate.maxRecords) ||
    !Number.isFinite(candidate.maxRecords) ||
    candidate.maxRecords < 0
  ) {
    return {
      valid: false,
      error: 'maxRecords must be a non-negative integer (0 for unlimited)'
    };
  }

  if (
    typeof candidate.maxAgeDays !== 'number' ||
    !Number.isInteger(candidate.maxAgeDays) ||
    !Number.isFinite(candidate.maxAgeDays) ||
    candidate.maxAgeDays < 0
  ) {
    return {
      valid: false,
      error: 'maxAgeDays must be a non-negative integer (0 for unlimited)'
    };
  }

  if (typeof candidate.autoPruneOnSave !== 'boolean') {
    return {
      valid: false,
      error: 'autoPruneOnSave must be a boolean'
    };
  }

  return {
    valid: true,
    config: {
      maxRecords: candidate.maxRecords,
      maxAgeDays: candidate.maxAgeDays,
      autoPruneOnSave: candidate.autoPruneOnSave
    }
  };
}

export interface PruneHistoryOptions {
  maxRecords?: number;
  maxAgeDays?: number;
  now?: number;
}

export interface PruneHistoryResult {
  prunedHistory: CleanupTransaction[];
  prunedCount: number;
}

/**
 * Pure, deterministic function that calculates history retention without filesystem access
 * or mutating the input array.
 *
 * Invariants:
 * 1. Records with missing, non-numeric, or malformed startedAt are strictly preserved
 *    to prevent accidental permanent audit loss.
 * 2. Valid timestamps are evaluated against maxAgeDays (if > 0).
 * 3. Records are deterministically ordered newest-first by startedAt descending,
 *    using original array index as a stable tie-breaker for identical timestamps.
 * 4. At most maxRecords are retained (if > 0).
 * 5. Retained CleanupTransaction objects are preserved intact by reference.
 */
export function pruneHistoryRecords(
  history: CleanupTransaction[],
  options?: PruneHistoryOptions
): PruneHistoryResult {
  if (!Array.isArray(history) || history.length === 0) {
    return { prunedHistory: [], prunedCount: 0 };
  }

  const now = options?.now ?? Date.now();
  const maxAgeDays = options?.maxAgeDays ?? 0;
  const maxRecords = options?.maxRecords ?? 0;

  const cutoff = maxAgeDays > 0 ? now - maxAgeDays * 24 * 60 * 60 * 1000 : null;

  // Track original index alongside record for stable tie-breaking
  interface IndexedRecord {
    tx: CleanupTransaction;
    originalIndex: number;
    isValidTimestamp: boolean;
  }

  const indexedRecords: IndexedRecord[] = history.map((tx, originalIndex) => {
    const isValid =
      typeof tx?.startedAt === 'number' &&
      !Number.isNaN(tx.startedAt) &&
      Number.isFinite(tx.startedAt) &&
      tx.startedAt > 0;

    return {
      tx,
      originalIndex,
      isValidTimestamp: isValid
    };
  });

  // Step 1: Age-based filtering
  // Invariant: Malformed or missing timestamps are NEVER assumed old; they are always kept.
  const ageRetained = indexedRecords.filter((item) => {
    if (!cutoff || !item.isValidTimestamp) {
      return true;
    }
    return item.tx.startedAt >= cutoff;
  });

  // Step 2: Deterministic Newest-First Ordering
  // Sort descending by valid startedAt.
  // Stable tie-breaker: original array index.
  // Records without valid timestamps are kept deterministically at the end, preserving stable order.
  const sorted = [...ageRetained].sort((a, b) => {
    if (a.isValidTimestamp && b.isValidTimestamp) {
      if (b.tx.startedAt !== a.tx.startedAt) {
        return b.tx.startedAt - a.tx.startedAt; // Newest first
      }
      return a.originalIndex - b.originalIndex; // Stable tie-breaker
    }

    if (a.isValidTimestamp && !b.isValidTimestamp) {
      return -1; // Valid comes before invalid
    }
    if (!a.isValidTimestamp && b.isValidTimestamp) {
      return 1; // Valid comes before invalid
    }

    return a.originalIndex - b.originalIndex; // Both invalid: stable tie-breaker
  });

  // Step 3: Count-based pruning (maxRecords)
  let countRetained: IndexedRecord[];
  if (maxRecords > 0 && sorted.length > maxRecords) {
    countRetained = sorted.slice(0, maxRecords);
  } else {
    countRetained = sorted;
  }

  const prunedHistory = countRetained.map((item) => item.tx);
  const prunedCount = history.length - prunedHistory.length;

  return {
    prunedHistory,
    prunedCount
  };
}
