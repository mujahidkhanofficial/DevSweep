/**
 * Checks whether an event target is an active text input or editable element.
 * Global keyboard shortcuts (such as Ctrl+1..5 or Ctrl+R) must never hijack keystrokes
 * while the user is typing into an input, textarea, or content-editable region.
 */
export function isTextInputElement(target: EventTarget | null): boolean {
  if (!target) {
    return false;
  }

  const isElement =
    (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) ||
    (typeof (target as any).tagName === 'string');

  if (!isElement) {
    return false;
  }

  const el = target as HTMLElement;
  const tagName = (el.tagName || '').toUpperCase();
  if (tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    // Non-text input types that shouldn't block navigation if desired, but checkboxes/radios have their own keys
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
  }

  if (tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  return Boolean(el.isContentEditable);
}
