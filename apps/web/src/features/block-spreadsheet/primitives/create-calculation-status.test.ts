import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalculationStatus } from './create-calculation-status';

afterEach(() => vi.useRealTimers());

function setup() {
  return createRoot((dispose) => {
    const [busy, setBusy] = createSignal(false);
    return { busy, setBusy, visible: createCalculationStatus(busy), dispose };
  });
}

describe('calculation status', () => {
  it('keeps short calculations quiet and cancels the pending indicator', async () => {
    vi.useFakeTimers();
    const status = setup();
    status.setBusy(true);
    expect(status.busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(status.visible()).toBe(false);
    status.setBusy(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(status.visible()).toBe(false);
    status.dispose();
  });

  it('shows sustained work, hides on completion, and starts a fresh delay next time', async () => {
    vi.useFakeTimers();
    const status = setup();
    status.setBusy(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(status.visible()).toBe(true);
    status.setBusy(false);
    expect(status.visible()).toBe(false);
    status.setBusy(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(status.visible()).toBe(false);
    status.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(status.visible()).toBe(false);
  });
});
