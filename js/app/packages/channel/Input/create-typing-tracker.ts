import { onCleanup } from 'solid-js';

/** How long after the last keystroke before we tell the server the user stopped typing. */
const INACTIVITY_TIMEOUT_MS = 2000;

type TypingTrackerCallbacks = {
  onStartTyping: () => void;
  onStopTyping: () => void;
};

/**
 * Tracks local typing activity and fires start/stop callbacks.
 *
 * - `onStartTyping` fires on the first keystroke and is not called again
 *    until after the user goes idle (stop fires first).
 * - `onStopTyping` fires after `INACTIVITY_TIMEOUT_MS` of inactivity,
 *    or immediately when `stop()` is called (e.g. on send / close).
 */
export function createTypingTracker(callbacks: TypingTrackerCallbacks) {
  let isTyping = false;
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
      callbacks.onStopTyping();
    }
  }

  function keystroke() {
    if (!isTyping) {
      isTyping = true;
      callbacks.onStartTyping();
    }
    // Reset (or start) the inactivity timer on every keystroke.
    clearTimer();
    inactivityTimer = setTimeout(stopTyping, INACTIVITY_TIMEOUT_MS);
  }

  onCleanup(stopTyping);

  return { keystroke, stop: stopTyping };
}
