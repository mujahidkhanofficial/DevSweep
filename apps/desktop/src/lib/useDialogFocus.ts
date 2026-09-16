import { useEffect, useRef } from 'react';

export interface UseDialogFocusOptions {
  /** Optional element to receive focus when dialog opens. Defaults to first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Callback fired when user presses Escape key. */
  onClose?: () => void;
  /** Whether to automatically move focus inside dialog on open. Default true. */
  autoFocus?: boolean;
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Reusable modal focus manager hook implementing WAI-ARIA dialog practices:
 * 1. Saves previously focused element before modal opens.
 * 2. Traps Tab and Shift+Tab cycles strictly within the dialog.
 * 3. Handles Escape to dismiss.
 * 4. Restores focus to the previously active element upon closing.
 */
export function useDialogFocus(
  isOpen: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  options?: UseDialogFocusOptions
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // 1. Save currently focused element
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    // 2. Initial focus
    if (options?.autoFocus !== false) {
      const initialTarget = options?.initialFocusRef?.current;
      if (initialTarget && typeof initialTarget.focus === 'function') {
        initialTarget.focus();
      } else {
        const firstFocusable = dialogEl.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
        if (firstFocusable && typeof firstFocusable.focus === 'function') {
          firstFocusable.focus();
        } else {
          dialogEl.focus();
        }
      }
    }

    // 3. Tab Trap & Escape Listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        options?.onClose?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusableElements = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter((el) => el.offsetParent !== null && !el.hasAttribute('disabled'));

      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = focusableElements[0];
      const lastEl = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab: if on first, cycle to last
        if (document.activeElement === firstEl || !dialogEl.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab: if on last, cycle to first
        if (document.activeElement === lastEl || !dialogEl.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // 4. Restore focus upon closing
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);
}
