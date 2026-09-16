import { ProtectedPathService, ProtectionCheckResult } from './ProtectedPathService.js';
import { FingerprintService, FingerprintValidationResult } from './FingerprintService.js';
import { SessionManager } from './SessionManager.js';
import { ScannedItem } from '../../shared/src/rules.types.js';

export interface PreExecutionValidationResult {
  allowed: boolean;
  item?: ScannedItem;
  reason?: string;
}

export class SafetyEngine {
  constructor(
    private protectedPathService: ProtectedPathService,
    private sessionManager: SessionManager
  ) {}

  /**
   * Evaluates if a candidate item is authorized for cleanup:
   * 1. Session exists and is valid
   * 2. Item exists within the session
   * 3. Rule ID matches
   * 4. Strict path containment inside rule root
   * 5. Protection check (System, User, Rule)
   * 6. Real-time fingerprint check (anti-TOCTOU)
   */
  public async validateCandidateForCleanup(
    scanSessionId: string,
    ruleId: string,
    itemId: string,
    ruleRoot: string
  ): Promise<PreExecutionValidationResult> {
    // 1. Session check
    const session = this.sessionManager.getSession(scanSessionId);
    if (!session) {
      return { allowed: false, reason: `Scan session "${scanSessionId}" is invalid or expired` };
    }

    if (session.isCancelled) {
      return { allowed: false, reason: `Scan session "${scanSessionId}" was cancelled` };
    }

    // 2. Item check
    const item = session.items.get(itemId);
    if (!item) {
      return { allowed: false, reason: `Item "${itemId}" does not belong to session "${scanSessionId}"` };
    }

    // 3. Rule ID check
    if (item.ruleId !== ruleId) {
      return {
        allowed: false,
        reason: `Item rule mismatch. Expected rule "${ruleId}", item is registered under "${item.ruleId}"`
      };
    }

    // 4. Protection & Containment check
    const protectionResult: ProtectionCheckResult = this.protectedPathService.checkPath(item.path, ruleRoot);
    if (protectionResult.isProtected) {
      return {
        allowed: false,
        reason: `Protected path policy violation (${protectionResult.tier}): ${protectionResult.reason}`
      };
    }

    // 5. Anti-TOCTOU Fingerprint check
    const fingerprintResult: FingerprintValidationResult = await FingerprintService.validate(item.fingerprint);
    if (!fingerprintResult.valid) {
      return {
        allowed: false,
        reason: `Item altered since scan: ${fingerprintResult.reason}`
      };
    }

    return {
      allowed: true,
      item
    };
  }

  public getProtectedPathService(): ProtectedPathService {
    return this.protectedPathService;
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
