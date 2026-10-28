import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlsVisibility } from './create-controls-visibility';

afterEach(() => vi.useRealTimers());

describe('call control visibility', () => {
  it('restarts the idle deadline on interaction and cancels it on disposal', () => {
    vi.useFakeTimers();
    const { controls, dispose } = createRoot((dispose) => ({
      dispose,
      controls: createControlsVisibility({
        enabled: () => true,
        keepVisible: () => false,
      }),
    }));
    try {
      vi.advanceTimersByTime(3000);
      controls.reveal();
      vi.advanceTimersByTime(3000);
      expect(controls.visible()).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(controls.visible()).toBe(false);
      controls.reveal();
    } finally {
      dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reacts to open interactions and leaving phone layout', () => {
    vi.useFakeTimers();
    const { controls, setEnabled, setPinned, dispose } = createRoot(
      (dispose) => {
        const [enabled, setEnabled] = createSignal(true);
        const [pinned, setPinned] = createSignal(false);
        return {
          controls: createControlsVisibility({ enabled, keepVisible: pinned }),
          setEnabled,
          setPinned,
          dispose,
        };
      }
    );
    try {
      vi.advanceTimersByTime(4000);
      expect(controls.visible()).toBe(false);
      setPinned(true);
      vi.advanceTimersByTime(10000);
      expect(controls.visible()).toBe(true);
      setPinned(false);
      vi.advanceTimersByTime(4000);
      expect(controls.visible()).toBe(false);
      setEnabled(false);
      vi.advanceTimersByTime(10000);
      expect(controls.visible()).toBe(true);
      setEnabled(true);
      vi.advanceTimersByTime(4000);
      expect(controls.visible()).toBe(false);
    } finally {
      dispose();
    }
  });
});
