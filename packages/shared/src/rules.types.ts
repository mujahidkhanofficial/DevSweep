export type SafetyLevel = 'SAFE' | 'REBUILDABLE' | 'REVIEW' | 'PROTECTED';

export type CleanupCategory = 
  | 'NODE' 
  | 'GRADLE' 
  | 'ANDROID' 
  | 'FLUTTER' 
  | 'IDE' 
  | 'SYSTEM' 
  | 'GENERAL';

export type RebuildCost = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type ProtectionLevel = 'SYSTEM_PROTECTED' | 'USER_PROTECTED' | 'RULE_PROTECTED';

export interface CleanupExplanation {
  whyItExists: string;
  consequenceOfRemoval: string;
  potentialImpact: string;
  safetyConfidence: 'SAFE' | 'REBUILDABLE' | 'REVIEW';
}

export type ToolchainId =
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'flutter'
  | 'gradle'
  | 'android-sdk'
  | 'vscode'
  | 'git'
  | 'docker'
  | 'system';

export interface ItemFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface ScannedItem {
  id: string;
  ruleId: string;
  category: CleanupCategory;
  toolchainId?: ToolchainId;
  relatedToolchains?: ToolchainId[];
  label: string;
  path: string;
  size: number;
  fileCount: number;
  safetyLevel: SafetyLevel;
  selectedByDefault: boolean;
  fingerprint: ItemFingerprint;
  explanation: CleanupExplanation;
}

export function isItemAssociatedWithToolchain(
  item: ScannedItem,
  toolchainId: ToolchainId
): boolean {
  if (item.toolchainId === toolchainId) {
    return true;
  }
  return item.relatedToolchains?.includes(toolchainId) ?? false;
}

export interface ResolvedTargetRoot {
  ruleId: string;
  label: string;
  canonicalPath: string;
  exists: boolean;
}

export interface CleanupTransactionItemAudit {
  itemId?: string;
  path: string;
  sizeBytes: number;
  result: 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'CANCELLED';
  failureReason?: string;
  toolchainId?: ToolchainId;
  safetyLevel?: SafetyLevel;
  ruleId?: string;
}

export interface CleanupTransaction {
  transactionId: string;
  scanSessionId: string;
  ruleId: string;
  status: 'PENDING' | 'VALIDATING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED';
  dryRun: boolean;
  startedAt: number;
  completedAt?: number;
  totalRequested: number;
  validatedCount: number;
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
  timedOutCount: number;
  cancelledCount: number;
  bytesReclaimed: number;
  skippedDetails: Array<{
    path: string;
    reason: string;
    errorCode?: string;
    operation?: string;
    category?: string;
    toolchainId?: ToolchainId;
    safetyLevel?: SafetyLevel;
    ruleId?: string;
  }>;
  items?: CleanupTransactionItemAudit[];
  toolchainId?: ToolchainId;
  relatedToolchains?: ToolchainId[];
  safetyLevel?: SafetyLevel;
}

export interface CleanupRule {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly category: CleanupCategory;
  readonly toolchainId?: ToolchainId;
  readonly relatedToolchains?: ToolchainId[];
  readonly safetyLevel: SafetyLevel;
  readonly defaultSelection: boolean;
  readonly requiresElevation: boolean;
  readonly rebuildCost: RebuildCost;
  readonly networkRequiredToRebuild: boolean;
  readonly warning?: string;

  resolveTargets(): Promise<ResolvedTargetRoot[]>;
  explain(): CleanupExplanation;
}
