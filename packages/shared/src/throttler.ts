/**
 * Bounded IPC Progress Throttler
 *
 * Invariants:
 * 1. At most one pending progress payload per channel.
 * 2. Terminal events flush/cancel pending progress and deliver terminal state immediately.
 * 3. Once terminated, no stale or delayed progress can ever be emitted.
 */
export const PROGRESS_UPDATE_INTERVAL_MS = 66; // ~15-16 Hz bounded cadence

export interface ThrottledProgressEmitter<T> {
  sendProgress: (data: T) => void;
  sendTerminal: (terminalData: T) => void;
  flush: () => void;
}

export function createThrottledProgressEmitter<T>(
  emit: (data: T) => void,
  intervalMs = PROGRESS_UPDATE_INTERVAL_MS
): ThrottledProgressEmitter<T> {
  let lastEmitTime = -Infinity;
  let timer: any = null;
  let pendingProgress: T | null = null;
  let isTerminated = false;

  return {
    sendProgress(data: T) {
      if (isTerminated) return;

      const now = performance.now();
      const elapsed = now - lastEmitTime;

      if (elapsed >= intervalMs && !timer) {
        lastEmitTime = now;
        pendingProgress = null;
        emit(data);
      } else {
        pendingProgress = data;
        if (!timer) {
          const delay = Math.max(1, intervalMs - elapsed);
          timer = setTimeout(() => {
            timer = null;
            if (isTerminated) {
              pendingProgress = null;
              return;
            }
            if (pendingProgress !== null) {
              lastEmitTime = performance.now();
              const payload = pendingProgress;
              pendingProgress = null;
              emit(payload);
            }
          }, delay);
        }
      }
    },

    sendTerminal(terminalData: T) {
      isTerminated = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingProgress = null;
      lastEmitTime = performance.now();
      emit(terminalData);
    },

    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pendingProgress !== null && !isTerminated) {
        lastEmitTime = performance.now();
        const payload = pendingProgress;
        pendingProgress = null;
        emit(payload);
      }
    }
  };
}
