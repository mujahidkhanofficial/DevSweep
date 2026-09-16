import { describe, it, expect, vi } from 'vitest';
import { createThrottledProgressEmitter } from '../packages/shared/src/throttler.js';

describe('Bounded IPC Progress Throttler', () => {
  it('bounds high-frequency progress events and emits at most one pending payload per interval', async () => {
    vi.useFakeTimers();
    const emitted: any[] = [];
    const emitter = createThrottledProgressEmitter<any>((data) => emitted.push(data), 66);

    // Rapid burst of 50 progress updates
    for (let i = 1; i <= 50; i++) {
      emitter.sendProgress({ step: i, status: 'RUNNING' });
    }

    // First event emitted synchronously
    expect(emitted.length).toBe(1);
    expect(emitted[0].step).toBe(1);

    // Advance 30ms (less than 66ms interval) - no new emission yet
    vi.advanceTimersByTime(30);
    expect(emitted.length).toBe(1);

    // Advance remaining 36ms (total 66ms) - pending latest progress should fire
    vi.advanceTimersByTime(36);
    expect(emitted.length).toBe(2);
    // At most one pending payload kept: it should be the latest (step 50)
    expect(emitted[1].step).toBe(50);

    vi.useRealTimers();
  });

  it('guarantees terminal events supersede pending progress and deliver immediately', () => {
    vi.useFakeTimers();
    const emitted: any[] = [];
    const emitter = createThrottledProgressEmitter<any>((data) => emitted.push(data), 66);

    // Initial event
    emitter.sendProgress({ step: 1, status: 'RUNNING' });
    expect(emitted.length).toBe(1);

    // Queue rapid progress during the throttle window
    emitter.sendProgress({ step: 2, status: 'RUNNING' });
    emitter.sendProgress({ step: 3, status: 'RUNNING' });

    // Terminal event occurs (e.g. COMPLETED or CANCELLED)
    emitter.sendTerminal({ step: 3, status: 'COMPLETED' });

    // Terminal delivered immediately
    expect(emitted.length).toBe(2);
    expect(emitted[1].status).toBe('COMPLETED');

    // Advance timers well beyond the throttle window
    vi.advanceTimersByTime(200);

    // Invariant: no stale progress was emitted after termination!
    expect(emitted.length).toBe(2);

    // Any further progress calls after termination are dropped
    emitter.sendProgress({ step: 4, status: 'RUNNING' });
    vi.advanceTimersByTime(200);
    expect(emitted.length).toBe(2);

    vi.useRealTimers();
  });

  it('flushes pending payload when requested prior to termination', () => {
    vi.useFakeTimers();
    const emitted: any[] = [];
    const emitter = createThrottledProgressEmitter<any>((data) => emitted.push(data), 66);

    emitter.sendProgress({ step: 1 });
    emitter.sendProgress({ step: 2 });
    expect(emitted.length).toBe(1);

    emitter.flush();
    expect(emitted.length).toBe(2);
    expect(emitted[1].step).toBe(2);

    vi.useRealTimers();
  });
});
