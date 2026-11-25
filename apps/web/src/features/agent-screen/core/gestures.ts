import type { ScreenInputEvent } from '../transports/types';
import {
  type Point,
  panBy,
  toGuestPoint,
  type ViewGeometry,
  type Viewport,
  zoomAt,
} from './geometry';

/**
 * Turns pointer and wheel events on the viewer into guest input and local
 * viewport changes. Pure: the caller feeds events and applies the effects.
 *
 * Two fingers always move the local view (pinch to zoom, drag to pan) and
 * never reach the guest. One finger follows the touch mode the driver picks:
 * `view` pans the picture, `touch` taps a click, drags a drag and long-presses
 * a right click, `scroll` drags the guest's page. Anyone not driving gets
 * `view`. A mouse drives the guest directly; Ctrl+wheel (a trackpad pinch)
 * zooms locally.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';

export type TouchMode = 'view' | 'touch' | 'scroll';

export type PointerSample = {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  /** `PointerEvent.buttons`. */
  buttons: number;
  time: number;
};

export type GestureEvent =
  | { type: 'down'; pointer: PointerSample }
  | { type: 'move'; pointer: PointerSample }
  | { type: 'up'; pointer: PointerSample }
  | { type: 'cancel'; pointer: PointerSample }
  | {
      type: 'wheel';
      x: number;
      y: number;
      /** Wheel deltas in CSS px (`deltaMode` already applied). */
      dx: number;
      dy: number;
      ctrlKey: boolean;
    }
  | { type: 'longPress'; id: number };

export type GestureContext = {
  geometry: ViewGeometry;
  viewport: Viewport;
  /** True while this viewer holds the driver lease: input goes to the guest. */
  sendsInput: boolean;
  /** What one finger does while driving. */
  touchMode: TouchMode;
};

export type GestureEffect =
  | { type: 'input'; event: ScreenInputEvent }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'armLongPress'; id: number }
  | { type: 'cancelLongPress' };

type Track = { id: number; start: Point; last: Point };

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'mouse';
      id: number;
      buttons: number;
      last: Point;
      panning: boolean;
    }
  | {
      kind: 'oneFinger';
      mode: TouchMode;
      track: Track;
      moved: boolean;
      scrollRemainder: Point;
    }
  | {
      kind: 'twoFinger';
      tracks: [Track, Track];
      lastDistance: number;
      lastCentroid: Point;
    }
  /** A gesture ended early (long press, a third finger); wait for every finger to lift. */
  | { kind: 'settling'; ids: number[] };

export type GestureState = {
  phase: Phase;
  /** The last tap, for double-tap zoom in view mode. */
  lastTap: { point: Point; time: number } | undefined;
  wheelRemainder: Point;
};

export const INITIAL_GESTURE_STATE: GestureState = {
  phase: { kind: 'idle' },
  lastTap: undefined,
  wheelRemainder: { x: 0, y: 0 },
};

/** Movement below this many CSS px is still a tap. */
export const TAP_SLOP = 10;
/** A held, unmoved finger becomes a right click after this many ms. */
export const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_ZOOM = 2.5;
/** CSS px of finger travel per scroll notch. */
const TOUCH_SCROLL_STEP = 40;
/** CSS px of wheel delta per scroll notch. */
const WHEEL_SCROLL_STEP = 100;

const RFB_LEFT = 1;
const RFB_MIDDLE = 2;
const RFB_RIGHT = 4;

type StepResult = { state: GestureState; effects: GestureEffect[] };

/** DOM `buttons` (left 1, right 2, middle 4) to the RFB mask (left 1, middle 2, right 4). */
export function rfbButtons(domButtons: number): number {
  let mask = 0;
  if (domButtons & 1) mask |= RFB_LEFT;
  if (domButtons & 2) mask |= RFB_RIGHT;
  if (domButtons & 4) mask |= RFB_MIDDLE;
  return mask;
}

/**
 * Where the finger is while a touch-mode finger is down, for the loupe that
 * shows what is under it.
 */
export function touchPoint(state: GestureState): Point | undefined {
  const { phase } = state;
  if (phase.kind !== 'oneFinger' || phase.mode !== 'touch') return undefined;
  return phase.track.last;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointerInput(
  context: GestureContext,
  point: Point,
  buttons: number,
  clamp: boolean
): GestureEffect[] {
  const guest = toGuestPoint(context.geometry, context.viewport, point, clamp);
  if (!guest) return [];
  return [{ type: 'input', event: { kind: 'pointer', ...guest, buttons } }];
}

/** Move, press and release at one point: a click with `button`. */
function click(
  context: GestureContext,
  point: Point,
  button: number
): GestureEffect[] {
  const guest = toGuestPoint(context.geometry, context.viewport, point);
  if (!guest) return [];
  return [0, button, 0].map((buttons) => ({
    type: 'input',
    event: { kind: 'pointer', ...guest, buttons },
  }));
}

/** Turns accumulated travel into whole notches, keeping the rest. */
function notches(total: number, step: number): { count: number; rest: number } {
  const count = Math.trunc(total / step);
  return { count, rest: total - count * step };
}

function scrollInput(
  context: GestureContext,
  at: Point,
  dx: number,
  dy: number
): GestureEffect[] {
  if (dx === 0 && dy === 0) return [];
  const guest = toGuestPoint(context.geometry, context.viewport, at, true);
  if (!guest) return [];
  return [{ type: 'input', event: { kind: 'scroll', ...guest, dx, dy } }];
}

function stepMouse(
  state: GestureState,
  event: GestureEvent,
  context: GestureContext
): StepResult {
  const { phase } = state;
  if (event.type === 'longPress' || event.type === 'wheel') {
    return { state, effects: [] };
  }

  const point = { x: event.pointer.x, y: event.pointer.y };
  const buttons = rfbButtons(event.pointer.buttons);

  if (!context.sendsInput) {
    // Without control a mouse drag pans the zoomed view.
    if (event.type === 'down') {
      return {
        state: {
          ...state,
          phase: {
            kind: 'mouse',
            id: event.pointer.id,
            buttons,
            last: point,
            panning: true,
          },
        },
        effects: [],
      };
    }
    if (event.type === 'move' && phase.kind === 'mouse') {
      const viewport = panBy(
        context.geometry,
        context.viewport,
        point.x - phase.last.x,
        point.y - phase.last.y
      );
      return {
        state: { ...state, phase: { ...phase, last: point } },
        effects: [{ type: 'viewport', viewport }],
      };
    }
    if (event.type === 'up' || event.type === 'cancel') {
      return { state: { ...state, phase: { kind: 'idle' } }, effects: [] };
    }
    return { state, effects: [] };
  }

  const pressed = buttons !== 0;
  const nextPhase: Phase = pressed
    ? {
        kind: 'mouse',
        id: event.pointer.id,
        buttons,
        last: point,
        panning: false,
      }
    : { kind: 'idle' };
  // Keep reporting while a button is held, even off the frame, so a drag ends
  // where the guest expects it.
  const clamp = phase.kind === 'mouse' || pressed;
  const cancelled = event.type === 'cancel';

  return {
    state: { ...state, phase: nextPhase },
    effects: pointerInput(context, point, cancelled ? 0 : buttons, clamp),
  };
}

function stepWheel(
  state: GestureState,
  event: Extract<GestureEvent, { type: 'wheel' }>,
  context: GestureContext
): StepResult {
  const at = { x: event.x, y: event.y };

  if (event.ctrlKey) {
    // Trackpad pinches arrive as Ctrl+wheel; zoom locally, never the guest.
    const viewport = zoomAt(
      context.geometry,
      context.viewport,
      Math.exp(-event.dy / 100),
      at
    );
    return { state, effects: [{ type: 'viewport', viewport }] };
  }

  if (!context.sendsInput) {
    const viewport = panBy(
      context.geometry,
      context.viewport,
      -event.dx,
      -event.dy
    );
    return { state, effects: [{ type: 'viewport', viewport }] };
  }

  const horizontal = notches(
    state.wheelRemainder.x + event.dx,
    WHEEL_SCROLL_STEP
  );
  const vertical = notches(
    state.wheelRemainder.y + event.dy,
    WHEEL_SCROLL_STEP
  );
  return {
    state: {
      ...state,
      wheelRemainder: { x: horizontal.rest, y: vertical.rest },
    },
    effects: scrollInput(context, at, horizontal.count, vertical.count),
  };
}

function startTwoFinger(first: Track, second: Track): Phase {
  return {
    kind: 'twoFinger',
    tracks: [first, second],
    lastDistance: distance(first.last, second.last),
    lastCentroid: centroid(first.last, second.last),
  };
}

function track(pointer: PointerSample): Track {
  const point = { x: pointer.x, y: pointer.y };
  return { id: pointer.id, start: point, last: point };
}

function oneFingerMode(context: GestureContext): TouchMode {
  return context.sendsInput ? context.touchMode : 'view';
}

function stepTouchDown(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext
): StepResult {
  const { phase } = state;
  const added = track(pointer);

  if (phase.kind === 'idle') {
    const mode = oneFingerMode(context);
    return {
      state: {
        ...state,
        phase: {
          kind: 'oneFinger',
          mode,
          track: added,
          moved: false,
          scrollRemainder: { x: 0, y: 0 },
        },
      },
      effects:
        mode === 'touch' ? [{ type: 'armLongPress', id: pointer.id }] : [],
    };
  }

  if (phase.kind === 'oneFinger') {
    // A second finger turns any one-finger gesture into a view gesture. A
    // touch drag in progress lets go of the button where it got to first.
    const dragging = phase.mode === 'touch' && phase.moved;
    const release = dragging
      ? pointerInput(context, phase.track.last, 0, true)
      : [];
    const cancel: GestureEffect[] =
      phase.mode === 'touch' ? [{ type: 'cancelLongPress' }] : [];
    return {
      state: { ...state, phase: startTwoFinger(phase.track, added) },
      effects: [...cancel, ...release],
    };
  }

  if (phase.kind === 'twoFinger') {
    const ids = [...phase.tracks.map((each) => each.id), pointer.id];
    return {
      state: { ...state, phase: { kind: 'settling', ids } },
      effects: [],
    };
  }

  if (phase.kind === 'settling') {
    return {
      state: {
        ...state,
        phase: { kind: 'settling', ids: [...phase.ids, pointer.id] },
      },
      effects: [],
    };
  }

  return { state, effects: [] };
}

function stepOneFingerMove(
  state: GestureState,
  phase: Extract<Phase, { kind: 'oneFinger' }>,
  point: Point,
  context: GestureContext
): StepResult {
  const moved = phase.moved || distance(point, phase.track.start) >= TAP_SLOP;
  const previous = phase.track.last;
  const next = { ...phase, moved, track: { ...phase.track, last: point } };
  const nextState = { ...state, phase: next };

  if (!moved) return { state: nextState, effects: [] };

  if (phase.mode === 'view') {
    // Pan from the last point, or from the start on the move that crosses the slop.
    const from = phase.moved ? previous : phase.track.start;
    const viewport = panBy(
      context.geometry,
      context.viewport,
      point.x - from.x,
      point.y - from.y
    );
    return { state: nextState, effects: [{ type: 'viewport', viewport }] };
  }

  if (phase.mode === 'touch') {
    if (phase.moved) {
      return {
        state: nextState,
        effects: pointerInput(context, point, RFB_LEFT, true),
      };
    }
    // The drag starts where the finger went down, not where it crossed the slop.
    return {
      state: nextState,
      effects: [
        { type: 'cancelLongPress' },
        ...pointerInput(context, phase.track.start, 0, false),
        ...pointerInput(context, phase.track.start, RFB_LEFT, false),
        ...pointerInput(context, point, RFB_LEFT, true),
      ],
    };
  }

  // Scroll: natural scrolling, so a finger moving up scrolls the page down.
  const from = phase.moved ? previous : phase.track.start;
  const horizontal = notches(
    phase.scrollRemainder.x + (from.x - point.x),
    TOUCH_SCROLL_STEP
  );
  const vertical = notches(
    phase.scrollRemainder.y + (from.y - point.y),
    TOUCH_SCROLL_STEP
  );
  return {
    state: {
      ...state,
      phase: {
        ...next,
        scrollRemainder: { x: horizontal.rest, y: vertical.rest },
      },
    },
    effects: scrollInput(
      context,
      phase.track.start,
      horizontal.count,
      vertical.count
    ),
  };
}

function stepTouchMove(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext
): StepResult {
  const { phase } = state;
  const point = { x: pointer.x, y: pointer.y };

  if (phase.kind === 'oneFinger' && phase.track.id === pointer.id) {
    return stepOneFingerMove(state, phase, point, context);
  }

  if (phase.kind !== 'twoFinger') return { state, effects: [] };

  const index = phase.tracks.findIndex((each) => each.id === pointer.id);
  if (index === -1) return { state, effects: [] };

  const tracks: [Track, Track] = [phase.tracks[0], phase.tracks[1]];
  tracks[index] = { ...tracks[index], last: point };
  const currentDistance = distance(tracks[0].last, tracks[1].last);
  const currentCentroid = centroid(tracks[0].last, tracks[1].last);

  // Zoom by the change in spread about the fingers' midpoint, then follow
  // the midpoint as it moves.
  const factor =
    phase.lastDistance > 0 ? currentDistance / phase.lastDistance : 1;
  const zoomed = zoomAt(
    context.geometry,
    context.viewport,
    factor,
    currentCentroid
  );
  const viewport = panBy(
    context.geometry,
    zoomed,
    currentCentroid.x - phase.lastCentroid.x,
    currentCentroid.y - phase.lastCentroid.y
  );

  return {
    state: {
      ...state,
      phase: {
        ...phase,
        tracks,
        lastDistance: currentDistance,
        lastCentroid: currentCentroid,
      },
    },
    effects: [{ type: 'viewport', viewport }],
  };
}

function stepTouchUp(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext,
  cancelled: boolean
): StepResult {
  const { phase } = state;
  const idle: GestureState = { ...state, phase: { kind: 'idle' } };

  if (phase.kind === 'oneFinger' && phase.track.id === pointer.id) {
    const cancel: GestureEffect[] =
      phase.mode === 'touch' ? [{ type: 'cancelLongPress' }] : [];

    if (phase.mode === 'touch' && phase.moved) {
      return {
        state: idle,
        effects: pointerInput(context, phase.track.last, 0, true),
      };
    }
    if (cancelled || phase.moved) return { state: idle, effects: cancel };
    if (phase.mode === 'touch') {
      return {
        state: idle,
        effects: [...cancel, ...click(context, phase.track.start, RFB_LEFT)],
      };
    }
    if (phase.mode === 'view') {
      return stepViewTap(idle, phase.track.start, pointer.time, context);
    }
    return { state: idle, effects: [] };
  }

  if (phase.kind === 'twoFinger') {
    const remaining = phase.tracks
      .map((each) => each.id)
      .filter((id) => id !== pointer.id);
    return {
      state: { ...state, phase: { kind: 'settling', ids: remaining } },
      effects: [],
    };
  }

  if (phase.kind === 'settling') {
    const ids = phase.ids.filter((id) => id !== pointer.id);
    if (ids.length === 0) return { state: idle, effects: [] };
    return {
      state: { ...state, phase: { kind: 'settling', ids } },
      effects: [],
    };
  }

  return { state, effects: [] };
}

/** A tap in view mode: a quick second tap toggles between fit and zoomed in. */
function stepViewTap(
  state: GestureState,
  point: Point,
  time: number,
  context: GestureContext
): StepResult {
  const previous = state.lastTap;
  const isDoubleTap =
    previous !== undefined &&
    time - previous.time < DOUBLE_TAP_MS &&
    distance(previous.point, point) < TAP_SLOP * 3;

  if (!isDoubleTap) {
    return { state: { ...state, lastTap: { point, time } }, effects: [] };
  }

  const factor =
    context.viewport.zoom > 1 ? 1 / context.viewport.zoom : DOUBLE_TAP_ZOOM;
  const viewport = zoomAt(context.geometry, context.viewport, factor, point);
  return {
    state: { ...state, lastTap: undefined },
    effects: [{ type: 'viewport', viewport }],
  };
}

function stepLongPress(
  state: GestureState,
  id: number,
  context: GestureContext
): StepResult {
  const { phase } = state;
  const pending =
    phase.kind === 'oneFinger' &&
    phase.mode === 'touch' &&
    phase.track.id === id &&
    !phase.moved;
  if (!pending || !context.sendsInput) return { state, effects: [] };

  return {
    state: { ...state, phase: { kind: 'settling', ids: [id] } },
    effects: click(context, phase.track.start, RFB_RIGHT),
  };
}

export function stepGesture(
  state: GestureState,
  event: GestureEvent,
  context: GestureContext
): StepResult {
  if (event.type === 'wheel') return stepWheel(state, event, context);
  if (event.type === 'longPress')
    return stepLongPress(state, event.id, context);
  if (event.pointer.kind === 'mouse') return stepMouse(state, event, context);

  // Pen and touch share the touch gestures.
  if (event.type === 'down')
    return stepTouchDown(state, event.pointer, context);
  if (event.type === 'move')
    return stepTouchMove(state, event.pointer, context);
  return stepTouchUp(state, event.pointer, context, event.type === 'cancel');
}
