import { describe, it, expect } from 'vitest';
import { RuleRegistry } from '../packages/cleanup-rules/src/RuleRegistry.js';
import { ExecuteCleanupRequestSchema, StartScanRequestSchema } from '../packages/shared/src/schemas.js';

describe('Rule Registry & Manifests', () => {
  const registry = new RuleRegistry();

  it('registers all required baseline developer and system rules', () => {
    const rules = registry.getAllRules();
    expect(rules.length).toBeGreaterThanOrEqual(8);

    const ruleIds = rules.map(r => r.id);
    expect(ruleIds).toContain('WINDOWS_USER_TEMP');
    expect(ruleIds).toContain('WINDOWS_CRASH_DUMPS');
    expect(ruleIds).toContain('NODE_NPM_CACHE');
    expect(ruleIds).toContain('NODE_PNPM_STORE');
    expect(ruleIds).toContain('NODE_YARN_CACHE');
    expect(ruleIds).toContain('GRADLE_CACHES');
    expect(ruleIds).toContain('FLUTTER_PUB_CACHE');
    expect(ruleIds).toContain('VSCODE_CACHES');
  });

  it('provides comprehensive explanations for every rule', () => {
    const rules = registry.getAllRules();
    for (const rule of rules) {
      const explanation = rule.explain();
      expect(explanation.whyItExists.length).toBeGreaterThan(10);
      expect(explanation.consequenceOfRemoval.length).toBeGreaterThan(10);
      expect(explanation.potentialImpact.length).toBeGreaterThan(10);
      expect(['SAFE', 'REBUILDABLE', 'REVIEW']).toContain(explanation.safetyConfidence);
    }
  });

  it('resolves canonical target paths with drive letter formatting', async () => {
    const tempRule = registry.getRule('WINDOWS_USER_TEMP');
    expect(tempRule).toBeDefined();

    const targets = await tempRule!.resolveTargets();
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0].canonicalPath).toMatch(/^[A-Z]:\\/);
  });
});

describe('Zod Schema Validation for IPC Payloads', () => {
  it('validates valid cleanup execution request', () => {
    const validPayload = {
      scanSessionId: 'SCAN-20260916-123456-abc',
      ruleId: 'NODE_NPM_CACHE',
      selectedItemIds: ['item-1', 'item-2'],
      dryRun: false
    };

    const result = ExecuteCleanupRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects execution request missing required fields', () => {
    const invalidPayload = {
      ruleId: 'NODE_NPM_CACHE'
      // missing scanSessionId and selectedItemIds
    };

    const result = ExecuteCleanupRequestSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('validates start scan request with allowed categories', () => {
    const payload = {
      categories: ['NODE', 'GRADLE', 'SYSTEM']
    };
    const result = StartScanRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
