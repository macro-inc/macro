import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTypingTracker,
  TYPING_INACTIVITY_TIMEOUT_MS,
  TYPING_START_REFRESH_INTERVAL_MS,
} from '../create-typing-tracker';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTypingTracker', () => {
  it('fires start on the first keystroke and stop after inactivity', () => {
    createRoot((dispose) => {
      const onStartTyping = vi.fn();
      const onStopTyping = vi.fn();
      const tracker = createTypingTracker({ onStartTyping, onStopTyping });

      tracker.keystroke();

      expect(onStartTyping).toHaveBeenCalledTimes(1);
      expect(onStopTyping).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TYPING_INACTIVITY_TIMEOUT_MS - 1);
      expect(onStopTyping).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onStopTyping).toHaveBeenCalledTimes(1);

      dispose();
    });
  });

  it('refreshes start while the user keeps typing', () => {
    createRoot((dispose) => {
      const onStartTyping = vi.fn();
      const onStopTyping = vi.fn();
      const tracker = createTypingTracker({ onStartTyping, onStopTyping });

      tracker.keystroke();
      expect(onStartTyping).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_000);
      tracker.keystroke();
      vi.advanceTimersByTime(1_000);
      tracker.keystroke();
      vi.advanceTimersByTime(TYPING_START_REFRESH_INTERVAL_MS - 2_001);
      tracker.keystroke();
      expect(onStartTyping).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      tracker.keystroke();
      expect(onStartTyping).toHaveBeenCalledTimes(2);
      expect(onStopTyping).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TYPING_INACTIVITY_TIMEOUT_MS);
      expect(onStopTyping).toHaveBeenCalledTimes(1);

      dispose();
    });
  });

  it('stops immediately when stop is called', () => {
    createRoot((dispose) => {
      const onStartTyping = vi.fn();
      const onStopTyping = vi.fn();
      const tracker = createTypingTracker({ onStartTyping, onStopTyping });

      tracker.keystroke();
      tracker.stop();

      expect(onStartTyping).toHaveBeenCalledTimes(1);
      expect(onStopTyping).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(TYPING_INACTIVITY_TIMEOUT_MS);
      expect(onStopTyping).toHaveBeenCalledTimes(1);

      dispose();
    });
  });
});
