import { IS_MAC } from '@core/constant/isMac';

export type OpenInNewTabIntent = {
  /** Cmd+shift+click switches to the new tab; plain cmd+click stays. */
  activate: boolean;
};

/**
 * Remembers that the last click carried the open-in-new-tab modifier
 * (cmd on macOS, ctrl elsewhere). The router middleware consumes it when a
 * navigation starts, so any click-driven navigation can become a new tab
 * without threading the event through every call site.
 */
let armed: { intent: OpenInNewTabIntent; expires: number } | undefined;
/** A pointerdown happened and its trailing click has not arrived yet. */
let awaitingGestureClick = false;
/** The current press gesture's intent was already consumed. */
let pressConsumed = false;

/** Long enough for a navigation that follows the click, short enough that an
 * unrelated later navigation cannot pick it up. */
const INTENT_EXPIRY_MS = 800;

function arm(event: MouseEvent) {
  const isGestureClick = event.type === 'click' && awaitingGestureClick;
  if (event.type === 'pointerdown') {
    awaitingGestureClick = true;
    pressConsumed = false;
  } else if (isGestureClick) {
    awaitingGestureClick = false;
  }

  const modifier = IS_MAC ? event.metaKey : event.ctrlKey;
  if (!modifier || event.button !== 0) {
    return;
  }

  // Some surfaces navigate on the press and ignore the click (sidebar list
  // rows). The press's intent is consumed then, and that gesture's trailing
  // click must not re-arm, or a stale intent would hijack whatever
  // navigation happens next. Only the matching pointer gesture's click is
  // held back; a keyboard-generated click has no pointerdown and still arms.
  if (isGestureClick && pressConsumed) {
    return;
  }

  const target = event.target;
  if (target instanceof Element && target.closest('[data-desktop-tab-strip]')) {
    return;
  }

  armed = {
    intent: { activate: event.shiftKey },
    expires: performance.now() + INTENT_EXPIRY_MS,
  };
}

/** One-shot read; stale intents are dropped. */
export function consumeOpenInNewTabIntent(): OpenInNewTabIntent | undefined {
  const current = armed;
  armed = undefined;
  if (!current || performance.now() > current.expires) return;

  pressConsumed = true;
  return current.intent;
}

/** Tab operations call this before navigating so they can't hijack themselves. */
export function disarmOpenInNewTabIntent(): void {
  armed = undefined;
}

export function installOpenInNewTabIntentTracker(): () => void {
  // Capture phase: some surfaces navigate from mousedown handlers, others on
  // click, and both may stop propagation.
  window.addEventListener('pointerdown', arm, { capture: true });
  window.addEventListener('click', arm, { capture: true });

  return () => {
    window.removeEventListener('pointerdown', arm, { capture: true });
    window.removeEventListener('click', arm, { capture: true });
    armed = undefined;
    awaitingGestureClick = false;
    pressConsumed = false;
  };
}
