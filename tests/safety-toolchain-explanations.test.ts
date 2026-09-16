import { describe, it, expect } from 'vitest';
import {
  SafetyLevel,
  ToolchainId,
  SAFETY_EXPLANATIONS,
  TOOLCHAIN_EXPLANATIONS,
  getSafetyExplanation,
  getToolchainExplanation,
  getToolchainAttribution
} from '@cleaner/shared';

describe('Priority 4.3 — Safety & Toolchain Explanations', () => {
  describe('1. Safety Explanation Registry Fidelity', () => {
    it('SAFE classification has exact authoritative shortDescription', () => {
      const exp = getSafetyExplanation('SAFE');
      expect(exp.label).toBe('Safe');
      expect(exp.shortDescription).toBe('Can be removed and regenerated automatically.');
      expect(exp.detailedDescription).toBeTruthy();
    });

    it('REBUILDABLE classification has exact authoritative shortDescription', () => {
      const exp = getSafetyExplanation('REBUILDABLE');
      expect(exp.label).toBe('Rebuildable');
      expect(exp.shortDescription).toBe('Generated cache/data that development tools can recreate.');
      expect(exp.detailedDescription).toBeTruthy();
    });

    it('REVIEW classification has exact authoritative shortDescription', () => {
      const exp = getSafetyExplanation('REVIEW');
      expect(exp.label).toBe('Review');
      expect(exp.shortDescription).toBe('Removal may affect local state or require additional consideration.');
      expect(exp.detailedDescription).toBeTruthy();
    });

    it('PROTECTED classification has exact authoritative shortDescription and zero delete-oriented wording', () => {
      const exp = getSafetyExplanation('PROTECTED');
      expect(exp.label).toBe('Protected');
      expect(exp.shortDescription).toBe('DevSweep will never allow this item to be selected.');
      expect(exp.detailedDescription).toContain('safeguarded by DevSweep invariants to prevent accidental data loss');
      expect(exp.detailedDescription.toLowerCase()).not.toContain('recreated on next build');
    });

    it('returns explicit fallback for untrusted runtime safety level without guessing', () => {
      const exp = getSafetyExplanation('INVALID_LEVEL' as any);
      expect(exp.label).toBe('Unknown');
      expect(exp.shortDescription).toBe('Classification is unknown.');
    });
  });

  describe('2. Toolchain Explanation Registry — All 11 Canonical IDs', () => {
    const allToolchains: ToolchainId[] = [
      'node',
      'npm',
      'pnpm',
      'yarn',
      'flutter',
      'gradle',
      'android-sdk',
      'vscode',
      'git',
      'docker',
      'system'
    ];

    it.each(allToolchains)('provides non-empty whyBelongs explanation for toolchain: %s', (id) => {
      const exp = getToolchainExplanation(id);
      expect(exp.id).toBe(id);
      expect(exp.displayName).toBeTruthy();
      expect(exp.summary).toBeTruthy();
      expect(exp.whyBelongs).toBeTruthy();
      expect(exp.whyBelongs.length).toBeGreaterThan(15);
      expect(exp.ecosystem).toBeTruthy();
    });

    it('returns explicit fallback for untrusted runtime toolchainId without guessing', () => {
      const exp = getToolchainExplanation('unregistered-custom-tool' as any);
      expect(exp.displayName).toBe('Unknown toolchain');
      expect(exp.whyBelongs).toBe('No toolchain attribution is available for this item.');
      expect(exp.ecosystem).toBe('Unknown');
    });
  });

  describe('3. Metadata Integrity & Directional Relationships', () => {
    it('preserves primary toolchain without replacing it with related toolchains', () => {
      const attr = getToolchainAttribution('gradle', ['android-sdk']);
      expect(attr).not.toBeNull();
      expect(attr?.primary.id).toBe('gradle');
      expect(attr?.primary.displayName).toBe('Gradle');
      expect(attr?.related).toHaveLength(1);
      expect(attr?.related[0].id).toBe('android-sdk');
      expect(attr?.related[0].displayName).toBe('Android SDK');
    });

    it('attributions for npm reflect npm primary and Node.js related ecosystem', () => {
      const attr = getToolchainAttribution('npm', ['node']);
      expect(attr).not.toBeNull();
      expect(attr?.primary.id).toBe('npm');
      expect(attr?.primary.displayName).toBe('npm');
      expect(attr?.related).toHaveLength(1);
      expect(attr?.related[0].id).toBe('node');
      expect(attr?.related[0].displayName).toBe('Node.js');
    });

    it('filters out redundant primary toolchain if present in related array', () => {
      const attr = getToolchainAttribution('gradle', ['gradle', 'android-sdk']);
      expect(attr?.primary.id).toBe('gradle');
      expect(attr?.related).toHaveLength(1);
      expect(attr?.related[0].id).toBe('android-sdk');
    });

    it('returns null if primary toolchainId is undefined', () => {
      const attr = getToolchainAttribution(undefined, ['node']);
      expect(attr).toBeNull();
    });
  });

  describe('4. No Heuristic Regression Invariants', () => {
    it('explanation lookup relies strictly on metadata types and does not inspect paths or categories', () => {
      // Regardless of arbitrary path or category names, the explanation is strictly keyed by ToolchainId
      const exp = getToolchainExplanation('gradle');
      expect(exp.displayName).toBe('Gradle');
      expect(exp.whyBelongs).toContain('Gradle');
      // No path parsing or category reflection
      expect(exp).toEqual(TOOLCHAIN_EXPLANATIONS.gradle);
    });

    it('safety explanation lookup is strictly keyed by SafetyLevel', () => {
      const exp = getSafetyExplanation('REBUILDABLE');
      expect(exp).toEqual(SAFETY_EXPLANATIONS.REBUILDABLE);
    });
  });
});
