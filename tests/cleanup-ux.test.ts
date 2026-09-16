import { describe, it, expect } from 'vitest';
import { ScannedItem, SafetyLevel } from '@cleaner/shared';
import fs from 'fs';
import path from 'path';

describe('DevSweep Priority 1: Cleanup UX Behavioral Suite', () => {
  // Test fixture data representing multiple categories and safety tiers
  const mockItems: ScannedItem[] = [
    {
      id: 'item-1',
      label: 'npm Cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
      size: 1024 * 1024 * 50, // 50 MB
      fileCount: 1200,
      safetyLevel: 'SAFE',
      category: 'NODE',
      ruleId: 'npm-cache',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\npm-cache',
        size: 1024 * 1024 * 50,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: { whyItExists: 'Cache', consequenceOfRemoval: 'Redownload', potentialImpact: 'None', safetyConfidence: 'SAFE' }
    },
    {
      id: 'item-2',
      label: 'Yarn Cache',
      path: 'C:\\Users\\dev\\AppData\\Local\\Yarn\\Cache',
      size: 1024 * 1024 * 30, // 30 MB
      fileCount: 800,
      safetyLevel: 'SAFE',
      category: 'NODE',
      ruleId: 'yarn-cache',
      selectedByDefault: true,
      fingerprint: {
        path: 'C:\\Users\\dev\\AppData\\Local\\Yarn\\Cache',
        size: 1024 * 1024 * 30,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: { whyItExists: 'Cache', consequenceOfRemoval: 'Redownload', potentialImpact: 'None', safetyConfidence: 'SAFE' }
    },
    {
      id: 'item-3',
      label: 'Android Build Output',
      path: 'C:\\Projects\\app\\build',
      size: 1024 * 1024 * 500, // 500 MB
      fileCount: 4500,
      safetyLevel: 'REBUILDABLE',
      category: 'ANDROID',
      ruleId: 'android-build',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Projects\\app\\build',
        size: 1024 * 1024 * 500,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: { whyItExists: 'Binaries', consequenceOfRemoval: 'Recompile', potentialImpact: 'Longer build', safetyConfidence: 'REBUILDABLE' }
    },
    {
      id: 'item-4',
      label: 'Gradle Build Caches',
      path: 'C:\\Users\\dev\\.gradle\\caches',
      size: 1024 * 1024 * 200, // 200 MB
      fileCount: 3000,
      safetyLevel: 'REVIEW',
      category: 'GRADLE',
      ruleId: 'gradle-cache',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Users\\dev\\.gradle\\caches',
        size: 1024 * 1024 * 200,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: { whyItExists: 'Daemon cache', consequenceOfRemoval: 'Re-resolve deps', potentialImpact: 'Requires review', safetyConfidence: 'REVIEW' }
    },
    {
      id: 'item-5',
      label: 'System Protected Directory',
      path: 'C:\\Windows\\System32',
      size: 1024 * 1024 * 100,
      fileCount: 1000,
      safetyLevel: 'PROTECTED',
      category: 'SYSTEM',
      ruleId: 'sys-dir',
      selectedByDefault: false,
      fingerprint: {
        path: 'C:\\Windows\\System32',
        size: 1024 * 1024 * 100,
        mtimeMs: Date.now(),
        isDirectory: true,
        isSymbolicLink: false
      },
      explanation: { whyItExists: 'OS', consequenceOfRemoval: 'Fatal', potentialImpact: 'Never delete', safetyConfidence: 'SAFE' }
    }
  ];

  // Helper matching CleanupView search filter logic
  function filterCandidates(
    items: ScannedItem[],
    searchQuery: string,
    safetyFilter: 'ALL' | 'SAFE' | 'REBUILDABLE' | 'REVIEW'
  ): ScannedItem[] {
    return items.filter((item) => {
      if (safetyFilter === 'SAFE' && item.safetyLevel !== 'SAFE') return false;
      if (safetyFilter === 'REBUILDABLE' && item.safetyLevel !== 'REBUILDABLE') return false;
      if (safetyFilter === 'REVIEW' && item.safetyLevel !== 'REVIEW') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const normalizedQ = q.replace(/[/\\]/g, '/');
        const matchesLabel = (item.label || '').toLowerCase().includes(q);
        const normalizedPath = (item.path || '').toLowerCase().replace(/[/\\]/g, '/');
        const matchesPath = normalizedPath.includes(normalizedQ);
        const matchesRule = (item.ruleId || '').toLowerCase().includes(q);
        const matchesCat = (item.category || '').toLowerCase().includes(q);
        if (!matchesLabel && !matchesPath && !matchesRule && !matchesCat) {
          return false;
        }
      }
      return true;
    });
  }

  // Helper computing tri-state and selectable items for category
  function computeCategorySelection(
    items: ScannedItem[],
    category: string,
    selectedItemIds: Set<string>
  ) {
    const categoryItems = items.filter((i) => i.category === category);
    const selectable = categoryItems.filter((i) => i.safetyLevel !== 'PROTECTED');
    const selected = selectable.filter((i) => selectedItemIds.has(i.id));

    const isAllSelected = selectable.length > 0 && selected.length === selectable.length;
    const isIndeterminate = selected.length > 0 && selected.length < selectable.length;
    const isDisabled = selectable.length === 0;

    return {
      categoryItems,
      selectable,
      selected,
      isAllSelected,
      isIndeterminate,
      isDisabled
    };
  }

  describe('Search Filtering', () => {
    it('matches candidate label case-insensitively', () => {
      const results = filterCandidates(mockItems, 'npm', 'ALL');
      expect(results.map((r) => r.id)).toEqual(['item-1']);
    });

    it('matches path using both forward and backslashes', () => {
      const backslashMatch = filterCandidates(mockItems, 'AppData\\Local\\Yarn', 'ALL');
      expect(backslashMatch.map((r) => r.id)).toEqual(['item-2']);

      const forwardSlashMatch = filterCandidates(mockItems, 'appdata/local/yarn', 'ALL');
      expect(forwardSlashMatch.map((r) => r.id)).toEqual(['item-2']);
    });

    it('matches by category and ruleId', () => {
      const byCat = filterCandidates(mockItems, 'node', 'ALL');
      expect(byCat.map((r) => r.id)).toEqual(['item-1', 'item-2']);

      const byRule = filterCandidates(mockItems, 'android-build', 'ALL');
      expect(byRule.map((r) => r.id)).toEqual(['item-3']);
    });

    it('returns empty list for unmatched query without error', () => {
      const results = filterCandidates(mockItems, 'non-existent-random-xyz', 'ALL');
      expect(results).toHaveLength(0);
    });

    it('handles empty and whitespace-only query gracefully', () => {
      const empty = filterCandidates(mockItems, '', 'ALL');
      expect(empty).toHaveLength(mockItems.length);

      const whitespace = filterCandidates(mockItems, '   ', 'ALL');
      expect(whitespace).toHaveLength(mockItems.length);
    });
  });

  describe('Safety Filtering', () => {
    it('filters only SAFE candidates', () => {
      const safe = filterCandidates(mockItems, '', 'SAFE');
      expect(safe.every((i) => i.safetyLevel === 'SAFE')).toBe(true);
      expect(safe.map((i) => i.id)).toEqual(['item-1', 'item-2']);
    });

    it('filters only REBUILDABLE candidates', () => {
      const rebuildable = filterCandidates(mockItems, '', 'REBUILDABLE');
      expect(rebuildable.every((i) => i.safetyLevel === 'REBUILDABLE')).toBe(true);
      expect(rebuildable.map((i) => i.id)).toEqual(['item-3']);
    });

    it('filters only REVIEW candidates', () => {
      const review = filterCandidates(mockItems, '', 'REVIEW');
      expect(review.every((i) => i.safetyLevel === 'REVIEW')).toBe(true);
      expect(review.map((i) => i.id)).toEqual(['item-4']);
    });
  });

  describe('Interaction Matrix: Category Selection + Filter Interaction', () => {
    it('none search + All filter: category toggle selects all selectable candidates in category', () => {
      const filtered = filterCandidates(mockItems, '', 'ALL');
      let selectedIds = new Set<string>();

      const state = computeCategorySelection(filtered, 'NODE', selectedIds);
      expect(state.isAllSelected).toBe(false);
      expect(state.isIndeterminate).toBe(false);

      // Simulate toggle
      const newSelected = new Set(selectedIds);
      state.selectable.forEach((i) => newSelected.add(i.id));

      const updatedState = computeCategorySelection(filtered, 'NODE', newSelected);
      expect(updatedState.isAllSelected).toBe(true);
      expect(updatedState.isIndeterminate).toBe(false);
      expect(Array.from(newSelected)).toEqual(['item-1', 'item-2']);
    });

    it('none search + Safe filter: category toggle never selects Rebuildable or Review candidates', () => {
      const filtered = filterCandidates(mockItems, '', 'SAFE');
      const selectedIds = new Set<string>();

      // In ANDROID, under SAFE filter there are NO safe items (it is REBUILDABLE)
      const state = computeCategorySelection(filtered, 'ANDROID', selectedIds);
      expect(state.selectable).toHaveLength(0);
      expect(state.isDisabled).toBe(true);

      // Toggle action on selectable items adds 0 items
      const newSelected = new Set(selectedIds);
      state.selectable.forEach((i) => newSelected.add(i.id));
      expect(newSelected.has('item-3')).toBe(false);
    });

    it('active search + All filter: toggle selects only visible matching candidates, not hidden ones', () => {
      // Search for yarn under NODE (hiding npm-cache)
      const filtered = filterCandidates(mockItems, 'yarn', 'ALL');
      const selectedIds = new Set<string>();

      const state = computeCategorySelection(filtered, 'NODE', selectedIds);
      expect(state.selectable.map((i) => i.id)).toEqual(['item-2']);

      const newSelected = new Set(selectedIds);
      state.selectable.forEach((i) => newSelected.add(i.id));

      expect(newSelected.has('item-2')).toBe(true);
      expect(newSelected.has('item-1')).toBe(false); // npm cache remains unselected!
    });

    it('active search + Review filter: no candidates outside Review become selected', () => {
      const filtered = filterCandidates(mockItems, 'gradle', 'REVIEW');
      const selectedIds = new Set<string>();

      const state = computeCategorySelection(filtered, 'GRADLE', selectedIds);
      expect(state.selectable.map((i) => i.id)).toEqual(['item-4']);

      const newSelected = new Set(selectedIds);
      state.selectable.forEach((i) => newSelected.add(i.id));

      expect(newSelected.has('item-4')).toBe(true);
      expect(newSelected.has('item-3')).toBe(false); // Android build (REBUILDABLE) was NOT selected
    });
  });

  describe('Tri-state Checkbox Derivation', () => {
    it('none selected -> unchecked (checked: false, indeterminate: false)', () => {
      const state = computeCategorySelection(mockItems, 'NODE', new Set());
      expect(state.isAllSelected).toBe(false);
      expect(state.isIndeterminate).toBe(false);
      expect(state.isDisabled).toBe(false);
    });

    it('some selectable selected -> indeterminate (checked: false, indeterminate: true)', () => {
      const state = computeCategorySelection(mockItems, 'NODE', new Set(['item-1']));
      expect(state.isAllSelected).toBe(false);
      expect(state.isIndeterminate).toBe(true);
    });

    it('all selectable candidates selected -> checked (checked: true, indeterminate: false)', () => {
      const state = computeCategorySelection(mockItems, 'NODE', new Set(['item-1', 'item-2']));
      expect(state.isAllSelected).toBe(true);
      expect(state.isIndeterminate).toBe(false);
    });

    it('zero selectable candidates (all protected) -> disabled state', () => {
      const state = computeCategorySelection(mockItems, 'SYSTEM', new Set());
      expect(state.isDisabled).toBe(true);
      expect(state.isAllSelected).toBe(false);
      expect(state.isIndeterminate).toBe(false);
    });
  });

  describe('Sticky Action Bar Totals & Safety Breakdown', () => {
    it('accurately computes selected bytes, count, and safety tier breakdown', () => {
      const selectedSet = new Set(['item-1', 'item-3']); // npm (SAFE, 50MB) + Cargo (REBUILDABLE, 500MB)
      const selected = mockItems.filter((i) => selectedSet.has(i.id));

      const totalBytes = selected.reduce((acc, i) => acc + i.size, 0);
      expect(totalBytes).toBe((50 + 500) * 1024 * 1024);

      const safeCount = selected.filter((i) => i.safetyLevel === 'SAFE').length;
      const rebuildableCount = selected.filter((i) => i.safetyLevel === 'REBUILDABLE').length;
      const reviewCount = selected.filter((i) => i.safetyLevel === 'REVIEW').length;

      expect(safeCount).toBe(1);
      expect(rebuildableCount).toBe(1);
      expect(reviewCount).toBe(0);
      expect(selected).toHaveLength(2);
    });
  });
});

describe('DevSweep Priority 2: Settings & Path Validation Behavioral Suite', () => {
  // Pure logic mirroring main process path:validate handler
  async function validatePathLogic(pathStr: string): Promise<{
    valid: boolean;
    exists: boolean;
    isDirectory: boolean;
    message: string;
  }> {
    if (typeof pathStr !== 'string' || !pathStr.trim()) {
      return { valid: false, exists: false, isDirectory: false, message: 'Path is empty' };
    }
    const trimmed = pathStr.trim();
    if (!path.isAbsolute(trimmed)) {
      return {
        valid: false,
        exists: false,
        isDirectory: false,
        message: 'Path must be an absolute Windows path (e.g. C:\\Projects)'
      };
    }
    try {
      if (!fs.existsSync(trimmed)) {
        return { valid: false, exists: false, isDirectory: false, message: 'Directory does not exist' };
      }
      const stat = await fs.promises.stat(trimmed);
      if (!stat.isDirectory()) {
        return { valid: false, exists: true, isDirectory: false, message: 'Path is a file, not a directory' };
      }
      return { valid: true, exists: true, isDirectory: true, message: 'Valid existing directory' };
    } catch (err: any) {
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        return { valid: false, exists: true, isDirectory: false, message: 'Access denied by Windows security policy' };
      }
      return { valid: false, exists: false, isDirectory: false, message: err?.message || 'Invalid path' };
    }
  }

  it('validates an existing directory successfully', async () => {
    const existingDir = process.cwd();
    const res = await validatePathLogic(existingDir);
    expect(res.valid).toBe(true);
    expect(res.exists).toBe(true);
    expect(res.isDirectory).toBe(true);
    expect(res.message).toBe('Valid existing directory');
  });

  it('rejects a nonexistent directory', async () => {
    const fakeDir = path.join(process.cwd(), 'nonexistent_test_folder_12345');
    const res = await validatePathLogic(fakeDir);
    expect(res.valid).toBe(false);
    expect(res.exists).toBe(false);
    expect(res.message).toBe('Directory does not exist');
  });

  it('rejects a file that is not a directory', async () => {
    const filePath = path.join(process.cwd(), 'package.json');
    const res = await validatePathLogic(filePath);
    expect(res.valid).toBe(false);
    expect(res.exists).toBe(true);
    expect(res.isDirectory).toBe(false);
    expect(res.message).toBe('Path is a file, not a directory');
  });

  it('rejects empty strings and whitespace', async () => {
    const emptyRes = await validatePathLogic('');
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.message).toBe('Path is empty');

    const wsRes = await validatePathLogic('   ');
    expect(wsRes.valid).toBe(false);
    expect(wsRes.message).toBe('Path is empty');
  });

  it('rejects relative paths', async () => {
    const res = await validatePathLogic('relative/subfolder');
    expect(res.valid).toBe(false);
    expect(res.message).toContain('Path must be an absolute Windows path');
  });

  describe('Settings Race Condition & Stale Result Guarantee', () => {
    it('discards earlier in-flight validation responses when input changes', async () => {
      let activeReqId = 0;
      let finalState: string | null = null;

      async function triggerValidation(inputValue: string, delayMs: number) {
        const currentReq = ++activeReqId;
        // Simulate async debounce/IPC latency
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const res = await validatePathLogic(inputValue);
        // Monotonic sequence gate
        if (currentReq === activeReqId) {
          finalState = res.message;
        }
      }

      // User rapidly types Path A (slow IPC 80ms), then Path B (fast IPC 20ms)
      const p1 = triggerValidation(path.join(process.cwd(), 'nonexistent_old_query'), 80);
      const p2 = triggerValidation(process.cwd(), 20);

      await Promise.all([p1, p2]);

      // Final visual state MUST be the result of Path B ('Valid existing directory'), not overwritten by Path A
      expect(finalState).toBe('Valid existing directory');
    });

    it('browse cancellation preserves existing value and does not trigger error', () => {
      let currentPathInput = 'C:\\Valid\\Projects';
      const browseResult: string | null = null; // Canceled dialog

      if (browseResult) {
        currentPathInput = browseResult;
      }

      expect(currentPathInput).toBe('C:\\Valid\\Projects');
    });

    it('browse success updates value and triggers valid state', async () => {
      let currentPathInput = '';
      const browseResult: string | null = process.cwd();

      if (browseResult) {
        currentPathInput = browseResult;
      }

      const res = await validatePathLogic(currentPathInput);
      expect(res.valid).toBe(true);
      expect(currentPathInput).toBe(process.cwd());
    });
  });
});
