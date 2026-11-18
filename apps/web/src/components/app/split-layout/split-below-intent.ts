/**
 * Remembers that the last click also held Option (Alt elsewhere) with Shift.
 * The layout manager consumes it when a Shift-click opens a new split, which
 * then goes below the split it came from instead of beside the others, so
 * every Shift-click surface supports it without threading the event through.
 */
let armedUntil: number | undefined;

/** Long enough for a navigation that follows the click, short enough that a later one can't pick it up. */
const INTENT_EXPIRY_MS = 800;

function arm(event: MouseEvent) {
  if (event.button !== 0) return;

  const opensBelow = event.altKey && event.shiftKey;
  armedUntil = opensBelow ? performance.now() + INTENT_EXPIRY_MS : undefined;
}

/** A key press starts a keyboard navigation, which a click's intent must not reach. */
function disarm() {
  armedUntil = undefined;
}

/** One-shot read; a stale intent is dropped. */
export function consumeSplitBelowIntent(): boolean {
  const until = armedUntil;
  armedUntil = undefined;

  return until !== undefined && performance.now() <= until;
}

export function installSplitBelowIntentTracker(): () => void {
  // Capture phase: some surfaces navigate from pointerdown handlers, others on
  // click, and both may stop propagation.
  window.addEventListener('pointerdown', arm, { capture: true });
  window.addEventListener('click', arm, { capture: true });
  window.addEventListener('keydown', disarm, { capture: true });

  return () => {
    window.removeEventListener('pointerdown', arm, { capture: true });
    window.removeEventListener('click', arm, { capture: true });
    window.removeEventListener('keydown', disarm, { capture: true });
    armedUntil = undefined;
  };
}
