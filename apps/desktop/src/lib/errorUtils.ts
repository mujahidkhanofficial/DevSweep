/**
 * Centralized error normalization boundary for DevSweep.
 *
 * Guarantees:
 * 1. Sanitizes stack traces, IPC internals, and node error boilerplate.
 * 2. Redacts sensitive local file paths (e.g. C:\Users\<username>\... -> ~\...).
 * 3. Formats common OS error codes (EBUSY, EACCES, EPERM, ENOENT) into clear, actionable guidance.
 * 4. Never leaks raw exception objects to the UI presentation layer.
 */
export function normalizeError(err: unknown): string {
  if (!err) {
    return 'An unexpected error occurred.';
  }

  let message: string;

  if (typeof err === 'string') {
    message = err;
  } else if (err instanceof Error) {
    message = err.message || err.toString();
  } else if (typeof err === 'object' && err !== null && 'message' in err) {
    message = String((err as any).message);
  } else {
    message = String(err);
  }

  // Strip Electron IPC boilerplate (e.g., "Error invoking remote method '...': Error: ...")
  message = message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');

  // Strip leading "Error: " prefixes
  message = message.replace(/^Error:\s*/i, '');

  // Strip multi-line stack traces if attached
  const firstNewline = message.indexOf('\n');
  if (firstNewline !== -1) {
    message = message.slice(0, firstNewline).trim();
  }

  // Redact local user profile paths: C:\Users\<username> or /home/<username>
  message = message.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s]+/gi, '$1***');
  message = message.replace(/(\/home\/)[^/\s]+/gi, '$1***');

  // Provide clear explanations for known OS error codes
  if (message.includes('EBUSY')) {
    return 'The target file is currently locked or in use by another running program (EBUSY).';
  }
  if (message.includes('EPERM') || message.includes('EACCES')) {
    return 'Permission denied. DevSweep lacks elevated permissions to modify this path (EPERM/EACCES).';
  }
  if (message.includes('ENOENT')) {
    return 'The target path no longer exists or was moved (ENOENT).';
  }

  return message.trim() || 'An unexpected error occurred.';
}
