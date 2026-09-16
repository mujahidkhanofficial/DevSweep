/**
 * Lightweight development-only performance instrumentation utility.
 * In production, all calls are zero-cost no-ops.
 */
const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);

class PerformanceTracker {
  private marks: Map<string, number> = new Map();

  mark(name: string): void {
    if (!isDev) return;
    const now = performance.now();
    this.marks.set(name, now);
    const start = this.marks.get('app-ready') ?? now;
    console.log(`[DevSweep Perf] ${name}: +${(now - start).toFixed(1)}ms`);
  }

  measure(startMark: string, endMark: string): number {
    if (!isDev) return 0;
    const start = this.marks.get(startMark);
    const end = this.marks.get(endMark);
    if (start === undefined || end === undefined) return 0;
    return end - start;
  }
}

export const perf = new PerformanceTracker();
