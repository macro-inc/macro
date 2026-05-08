import { onCleanup } from 'solid-js';

/** How long after the last keystroke before we tell the server the user stopped typing. */
export const TYPING_INACTIVITY_TIMEOUT_MS = 2_000;

/** How often to refresh the typing start event while the user keeps typing. */
export const TYPING_START_REFRESH_INTERVAL_MS = 4_000;

type TypingTrackerCallbacks = {
  onStartTyping: () => void;
  onStopTyping: () => void;
};

/**
 * Tracks local typing activity and fires start/stop callbacks.
 *
 * - `onStartTyping` fires on the first keystroke and periodically while the
 *    user keeps typing so other clients can safely expire stale indicators.
 * - `onStopTyping` fires after `TYPING_INACTIVITY_TIMEOUT_MS` of inactivity,
 *    or immediately when `stop()` is called (e.g. on send / close).
 */
export function createTypingTracker(callbacks: TypingTrackerCallbacks) {
  let isTyping = false;
  let lastStartTypingAt = 0;
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (inactivityTimer !== undefined) {
      clearTimeout(inactivityTimer);
      inactivityTimer = undefined;
    }
  }

  function stopTyping() {
    clearTimer();
    if (isTyping) {
      isTyping = false;
      lastStartTypingAt = 0;
      callbacks.onStopTyping();
    }
  }

  function keystroke() {
    const now = Date.now();

    if (!isTyping) {
      isTyping = true;
      lastStartTypingAt = now;
      callbacks.onStartTyping();
    } else if (now - lastStartTypingAt >= TYPING_START_REFRESH_INTERVAL_MS) {
      lastStartTypingAt = now;
      callbacks.onStartTyping();
    }

    // Reset (or start) the inactivity timer on every keystroke.
    clearTimer();
    inactivityTimer = setTimeout(stopTyping, TYPING_INACTIVITY_TIMEOUT_MS);
  }

  onCleanup(stopTyping);

  return { keystroke, stop: stopTyping };
}
