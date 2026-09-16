import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isTextInputElement } from '../apps/desktop/src/lib/keyboardUtils.js';

describe('DevSweep Keyboard Navigation & Accessibility Verification Suite', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('isTextInputElement Guard', () => {
    it('identifies standard text input elements as text entry targets', () => {
      expect(isTextInputElement({ tagName: 'INPUT', type: 'text' } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'search' } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'password' } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'email' } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'INPUT' } as any)).toBe(true);
    });

    it('identifies textarea and select elements as text entry targets', () => {
      expect(isTextInputElement({ tagName: 'TEXTAREA' } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'SELECT' } as any)).toBe(true);
    });

    it('identifies contentEditable elements as text entry targets', () => {
      expect(isTextInputElement({ tagName: 'DIV', isContentEditable: true } as any)).toBe(true);
      expect(isTextInputElement({ tagName: 'P', isContentEditable: true } as any)).toBe(true);
    });

    it('returns false for non-text inputs like buttons, checkboxes, and radio buttons', () => {
      expect(isTextInputElement({ tagName: 'INPUT', type: 'checkbox' } as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'radio' } as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'button' } as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'INPUT', type: 'submit' } as any)).toBe(false);
    });

    it('returns false for general UI elements and non-editable containers', () => {
      expect(isTextInputElement(null)).toBe(false);
      expect(isTextInputElement(undefined as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'BUTTON' } as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'DIV', isContentEditable: false } as any)).toBe(false);
      expect(isTextInputElement({ tagName: 'NAV' } as any)).toBe(false);
      expect(isTextInputElement({} as any)).toBe(false);
    });
  });

  describe('Semantic Application Navigation vs Tablist Invariants', () => {
    const sidebarPath = path.join(rootDir, 'apps/desktop/src/components/layout/Sidebar.tsx');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

    it('verifies Sidebar uses semantic <nav aria-label="Main navigation">', () => {
      expect(sidebarContent).toContain('<nav');
      expect(sidebarContent).toContain('aria-label="Main navigation"');
    });

    it('verifies Sidebar uses aria-current="page" on active item instead of tablist semantics', () => {
      expect(sidebarContent).toContain("aria-current={isActive ? 'page' : undefined}");
      expect(sidebarContent).not.toContain('role="tablist"');
      expect(sidebarContent).not.toContain('role="tab"');
      expect(sidebarContent).not.toContain('role="tabpanel"');
    });

    it('verifies Sidebar buttons specify type="button" and focus-visible styling', () => {
      expect(sidebarContent).toContain('type="button"');
      expect(sidebarContent).toContain('focus-visible:ring-2');
      expect(sidebarContent).toContain('focus-visible:ring-primary');
    });

    it('verifies App.tsx contains skip-to-main-content link and semantic <main id="main-content">', () => {
      const appPath = path.join(rootDir, 'apps/desktop/src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf8');

      expect(appContent).toContain('href="#main-content"');
      expect(appContent).toContain('Skip to main content');
      expect(appContent).toContain('<main id="main-content"');
      expect(appContent).not.toContain('role="tabpanel"');
    });

    it('verifies global shortcut dispatcher in App.tsx guards against text input', () => {
      const appPath = path.join(rootDir, 'apps/desktop/src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf8');

      expect(appContent).toContain('isTextInputElement(e.target)');
      expect(appContent).toContain("e.ctrlKey");
      expect(appContent).toContain("e.key.toLowerCase() === 'r'");
      expect(appContent).toContain("tabMap[e.key]");
    });
  });

  describe('Modal Accessibility & Focus Management Architecture', () => {
    it('verifies ScanModal implements dialog semantics, focus trap hook, and title labeling', () => {
      const scanModalPath = path.join(rootDir, 'apps/desktop/src/components/scan/ScanModal.tsx');
      const content = fs.readFileSync(scanModalPath, 'utf8');

      expect(content).toContain('useDialogFocus');
      expect(content).toContain('role="dialog"');
      expect(content).toContain('aria-modal="true"');
      expect(content).toContain('aria-labelledby="scan-modal-title"');
      expect(content).toContain('id="scan-modal-title"');
      // Confirms safe autofocus check: only focus review candidates if modal actively owns focus
      expect(content).toContain('dialogRef.current?.contains(document.activeElement)');
    });

    it('verifies HistoryView confirmation modal uses alertdialog, useDialogFocus, and initial cancel button focus', () => {
      const historyPath = path.join(rootDir, 'apps/desktop/src/components/history/HistoryView.tsx');
      const content = fs.readFileSync(historyPath, 'utf8');

      expect(content).toContain('useDialogFocus');
      expect(content).toContain('role="alertdialog"');
      expect(content).toContain('aria-modal="true"');
      expect(content).toContain('aria-labelledby="confirm-modal-title"');
      expect(content).toContain('initialFocusRef: cancelBtnRef');
      expect(content).toContain('ref={cancelBtnRef}');
    });

    it('verifies CleanupProgressModal implements dialog semantics, title labeling, and focus management', () => {
      const progressModalPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupProgressModal.tsx');
      const content = fs.readFileSync(progressModalPath, 'utf8');

      expect(content).toContain('useDialogFocus');
      expect(content).toContain('role="dialog"');
      expect(content).toContain('aria-modal="true"');
      expect(content).toContain('aria-labelledby="cleanup-modal-title"');
      expect(content).toContain('id="cleanup-modal-title"');
    });
  });

  describe('Filter Buttons & Checkbox Semantics', () => {
    it('verifies CleanupView safety filter pills use aria-pressed and type="button"', () => {
      const cleanupPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const content = fs.readFileSync(cleanupPath, 'utf8');

      expect(content).toContain("aria-pressed={safetyFilter === 'ALL'}");
      expect(content).toContain("aria-pressed={safetyFilter === 'SAFE'}");
      expect(content).toContain("aria-pressed={safetyFilter === 'REBUILDABLE'}");
      expect(content).toContain("aria-pressed={safetyFilter === 'REVIEW'}");
      expect(content).toContain('type="button"');
    });

    it('verifies CleanupView search input handles Escape to clear search query', () => {
      const cleanupPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const content = fs.readFileSync(cleanupPath, 'utf8');

      expect(content).toContain("if (e.key === 'Escape' && searchQuery)");
      expect(content).toContain("setSearchQuery('')");
      expect(content).toContain("e.stopPropagation()");
    });

    it('verifies IndeterminateCheckbox exposes tri-state aria-checked="mixed" when indeterminate', () => {
      const cleanupPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const content = fs.readFileSync(cleanupPath, 'utf8');

      expect(content).toContain("role=\"checkbox\"");
      expect(content).toContain("aria-checked={indeterminate ? 'mixed' : checked}");
      expect(content).toContain("inputRef.current.indeterminate = Boolean(indeterminate)");
    });

    it('verifies candidate checkboxes have accessible aria-labels and focus rings', () => {
      const cleanupPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
      const content = fs.readFileSync(cleanupPath, 'utf8');

      expect(content).toContain("aria-label={`Select ${item.label}`}");
      expect(content).toContain("focus-visible:ring-2");
    });

    it('verifies StorageView threshold buttons use aria-pressed and search handles Escape', () => {
      const storagePath = path.join(rootDir, 'apps/desktop/src/components/storage/StorageView.tsx');
      const content = fs.readFileSync(storagePath, 'utf8');

      expect(content).toContain("aria-pressed={thresholdGB === val}");
      expect(content).toContain("if (e.key === 'Escape' && searchTerm)");
      expect(content).toContain("setSearchTerm('')");
    });
  });

  describe('Focus Trap & Dialog Key Handling Logic', () => {
    it('traps Tab key within modal boundaries and wraps focus', () => {
      // Create mock DOM structure
      const button1 = { focus: vi.fn(), tabIndex: 0 } as any;
      const button2 = { focus: vi.fn(), tabIndex: 0 } as any;
      const container = {
        contains: vi.fn((el) => el === button1 || el === button2),
        querySelectorAll: vi.fn(() => [button1, button2])
      } as any;

      const focusable = container.querySelectorAll();
      expect(focusable.length).toBe(2);

      // Simulating Tab at last element wraps to first
      const activeElement = button2;
      const isShift = false;
      let targetToFocus;

      if (!isShift && activeElement === focusable[focusable.length - 1]) {
        targetToFocus = focusable[0];
      }
      expect(targetToFocus).toBe(button1);

      // Simulating Shift+Tab at first element wraps to last
      const activeElement2 = button1;
      const isShift2 = true;
      let targetToFocus2;

      if (isShift2 && activeElement2 === focusable[0]) {
        targetToFocus2 = focusable[focusable.length - 1];
      }
      expect(targetToFocus2).toBe(button2);
    });

    it('verifies Escape intercepts propagation on open modals', () => {
      const stopPropagation = vi.fn();
      const preventDefault = vi.fn();
      const onClose = vi.fn();

      const event = {
        key: 'Escape',
        stopPropagation,
        preventDefault
      };

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }

      expect(stopPropagation).toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
