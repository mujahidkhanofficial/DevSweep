import { ScannedItem, ToolchainId, CleanupTransaction } from './rules.types.js';

export type DiagnosisSource = 'CANONICAL' | 'HEURISTIC' | 'UNKNOWN';

export interface ItemRemediationDiagnosis {
  path: string;
  fileName: string;
  reason: string;
  errorCode?: string;
  source: DiagnosisSource;
  suggestedProcess: string;
  advisoryNote: string;
}

export interface RemediationDiagnosis {
  failedCount: number;
  likelyProcesses: string[];
  advisoryMessage: string;
  items: ItemRemediationDiagnosis[];
}

/**
 * Maps canonical ToolchainId to human-friendly developer process name.
 */
function getCanonicalProcessName(toolchainId: ToolchainId): string {
  switch (toolchainId) {
    case 'node':
      return 'Node.js';
    case 'npm':
      return 'npm / Node.js';
    case 'pnpm':
      return 'pnpm / Node.js';
    case 'yarn':
      return 'Yarn / Node.js';
    case 'flutter':
      return 'Flutter / Dart SDK';
    case 'gradle':
      return 'Gradle / Java';
    case 'android-sdk':
      return 'Android Studio / SDK';
    case 'vscode':
      return 'Visual Studio Code';
    case 'git':
      return 'Git';
    case 'docker':
      return 'Docker Desktop';
    case 'system':
      return 'Windows background process or Explorer';
    default:
      return 'Unknown toolchain';
  }
}

/**
 * Fallback path-based heuristics. Used ONLY when canonical metadata is absent.
 */
function getHeuristicProcessSuggestion(itemPath: string): string | null {
  const norm = itemPath.toLowerCase().replace(/\\/g, '/');

  if (norm.includes('/.gradle') || norm.includes('/gradle/') || norm.includes('caches/modules-2')) {
    return 'Gradle / Java';
  }
  if (norm.includes('/npm-cache') || norm.includes('/.npm') || norm.includes('/node_modules') || norm.includes('/node/')) {
    return 'Node.js / npm';
  }
  if (norm.includes('/pnpm-store') || norm.includes('/.pnpm')) {
    return 'pnpm / Node.js';
  }
  if (norm.includes('/yarn/cache') || norm.includes('/.yarn')) {
    return 'Yarn / Node.js';
  }
  if (norm.includes('/code/cache') || norm.includes('/.vscode') || norm.includes('/vscode/')) {
    return 'Visual Studio Code';
  }
  if (
    norm.includes('/pub-cache') ||
    norm.includes('/.pub-cache') ||
    norm.includes('/pub/cache') ||
    norm.includes('/flutter/')
  ) {
    return 'Flutter / Dart';
  }
  if (norm.includes('/android/sdk') || norm.includes('/build-tools')) {
    return 'Android Studio / SDK';
  }
  if (norm.includes('/.docker') || norm.includes('/docker/')) {
    return 'Docker Desktop';
  }
  if (norm.includes('/.git') || norm.includes('/git/')) {
    return 'Git';
  }
  if (norm.includes('/appdata/local/temp') || norm.includes('/temp/')) {
    return 'Background application or Windows Explorer';
  }

  return null;
}

/**
 * Explains common Windows filesystem lock error codes in advisory terms.
 */
function getErrorCodeAdvisory(code?: string, reason?: string): string {
  const normalized = `${code || ''} ${reason || ''}`.toUpperCase();
  if (normalized.includes('EBUSY') || normalized.includes('BUSY') || normalized.includes('LOCKED')) {
    return 'File is actively locked by another running process (EBUSY).';
  }
  if (normalized.includes('EPERM') || normalized.includes('NOT PERMITTED')) {
    return 'Operation not permitted (EPERM). The file may be in use or marked read-only.';
  }
  if (normalized.includes('EACCES') || normalized.includes('ACCESS IS DENIED') || normalized.includes('DENIED')) {
    return 'Access denied (EACCES). An open process handle or security policy may prevent removal.';
  }
  return reason || 'Cleanup encountered an unexpected filesystem impediment.';
}

/**
 * Diagnoses failed or skipped cleanup items with strict adherence to:
 * 1. Canonical ScannedItem metadata is prioritized.
 * 2. Path heuristics are fallback-only and never override canonical metadata.
 * 3. Never claims certainty — always advisory ("may currently be using these files").
 * 4. Distinguishes canonical vs heuristic vs unknown sources.
 */
export function diagnoseLockedFiles(
  skippedDetails: Array<{ path: string; reason: string; errorCode?: string; category?: string }>,
  scannedItems: ScannedItem[] = []
): RemediationDiagnosis {
  const itemsMapByPath = new Map<string, ScannedItem>();
  const itemsMapById = new Map<string, ScannedItem>();

  for (const item of scannedItems) {
    itemsMapByPath.set(item.path.toLowerCase().replace(/\\/g, '/'), item);
    itemsMapById.set(item.id, item);
  }

  const diagnosedItems: ItemRemediationDiagnosis[] = [];
  const likelyProcessesSet = new Set<string>();

  for (const detail of skippedDetails) {
    const rawPath = detail.path || '';
    const normPath = rawPath.toLowerCase().replace(/\\/g, '/');
    const fileName = rawPath.split(/[\\/]/).pop() || rawPath;

    // 1. Check canonical metadata first
    let matchedToolchainId: ToolchainId | undefined = (detail as any).toolchainId;
    let matchedItem: ScannedItem | undefined;

    if (!matchedToolchainId) {
      matchedItem = itemsMapByPath.get(normPath) || itemsMapById.get(rawPath);

      // If exact path not matched, check if skipped path resides inside any ScannedItem directory
      if (!matchedItem) {
        for (const item of scannedItems) {
          const itemNorm = item.path.toLowerCase().replace(/\\/g, '/');
          if (normPath === itemNorm || normPath.startsWith(itemNorm + '/')) {
            matchedItem = item;
            break;
          }
        }
      }

      if (matchedItem?.toolchainId) {
        matchedToolchainId = matchedItem.toolchainId;
      }
    }

    let source: DiagnosisSource = 'UNKNOWN';
    let suggestedProcess = 'Unknown process or background task';

    if (matchedToolchainId) {
      source = 'CANONICAL';
      suggestedProcess = getCanonicalProcessName(matchedToolchainId);
      likelyProcessesSet.add(suggestedProcess);
    } else {
      // 2. Fallback to path heuristic only when canonical metadata is unavailable
      const heuristicSuggestion = getHeuristicProcessSuggestion(rawPath);
      if (heuristicSuggestion) {
        source = 'HEURISTIC';
        suggestedProcess = heuristicSuggestion;
        likelyProcessesSet.add(heuristicSuggestion);
      } else {
        source = 'UNKNOWN';
        likelyProcessesSet.add('A background application or Windows service');
      }
    }

    diagnosedItems.push({
      path: rawPath,
      fileName,
      reason: detail.reason,
      errorCode: detail.errorCode,
      source,
      suggestedProcess,
      advisoryNote: getErrorCodeAdvisory(detail.errorCode, detail.reason)
    });
  }

  const likelyProcesses = Array.from(likelyProcessesSet);
  const count = skippedDetails.length;
  const fileWord = count === 1 ? 'file' : 'files';

  let advisoryMessage: string;
  if (likelyProcesses.length > 0 && !likelyProcesses.every((p) => p.startsWith('A background application'))) {
    advisoryMessage = `Possible cause:\n${likelyProcesses.join(' / ')} may currently be using these ${fileWord}.`;
  } else {
    advisoryMessage = `Possible cause:\nA background application or Windows service may currently have a lock on these ${fileWord}.`;
  }

  return {
    failedCount: count,
    likelyProcesses,
    advisoryMessage,
    items: diagnosedItems
  };
}

/**
 * Calculates the exact subset of candidate IDs to retry:
 * - Only includes failed/unremoved item IDs from the immediately preceding cleanup transaction.
 * - Excludes successfully deleted items.
 * - Never auto-selects unrelated candidates.
 */
export function getRetryCandidateIds(
  lastTransaction: CleanupTransaction,
  availableItems: ScannedItem[]
): string[] {
  if (!lastTransaction || !lastTransaction.skippedDetails || lastTransaction.skippedDetails.length === 0) {
    return [];
  }

  const failedPathSet = new Set<string>();
  for (const detail of lastTransaction.skippedDetails) {
    if (detail.path) {
      failedPathSet.add(detail.path.toLowerCase().replace(/\\/g, '/'));
      failedPathSet.add(detail.path);
    }
  }

  const retryIds: string[] = [];
  for (const item of availableItems) {
    const normItemPath = item.path.toLowerCase().replace(/\\/g, '/');
    let isFailed = failedPathSet.has(normItemPath) || failedPathSet.has(item.id) || failedPathSet.has(item.path);
    if (!isFailed) {
      for (const failedPath of failedPathSet) {
        if (failedPath.startsWith(normItemPath + '/')) {
          isFailed = true;
          break;
        }
      }
    }
    if (isFailed) {
      retryIds.push(item.id);
    }
  }

  return retryIds;
}
