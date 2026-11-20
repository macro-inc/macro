import type { ScreenInputEvent } from '../transports/types';
import {
  panBy,
  type Point,
  toGuestPoint,
  type ViewGeometry,
  type Viewport,
  zoomAt,
} from './geometry';

/**
 * Turns pointer and wheel events on the viewer into guest input and local
 * viewport changes. Pure: the caller feeds events and applies the effects.
 *
 * The split the phone needs: pinching (and, without control, any drag) only
 * moves the local viewport; a tap, a one-finger drag and a two-finger swipe
 * become a guest click, drag and scroll. A long press is a right click. A
 * mouse drives the guest directly; Ctrl+wheel (a trackpad pinch) zooms.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';

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
  /** True while this viewer drives and is in control mode: input goes to the guest. */
  sendsInput: boolean;
};

export type GestureEffect =
  | { type: 'input'; event: ScreenInputEvent }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'armLongPress'; id: number }
  | { type: 'cancelLongPress' };

type Track = { id: number; start: Point; last: Point; startTime: number };

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'mouse';
      id: number;
      buttons: number;
      last: Point;
      panning: boolean;
    }
  | { kind: 'touchPending'; track: Track }
  | { kind: 'touchDrag'; track: Track; panning: boolean }
  | {
      kind: 'twoFinger';
      tracks: [Track, Track];
      intent: 'undecided' | 'pinch' | 'scroll';
      lastDistance: number;
      lastCentroid: Point;
      scrollRemainder: Point;
    }
  /** A gesture ended early (long press, a third finger); wait for every finger to lift. */
  | { kind: 'settling'; ids: number[] };

export type GestureState = {
  phase: Phase;
  /** The last tap, for double-tap zoom in viewport mode. */
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
/** Pinch distance change that decides a two-finger gesture is a zoom. */
const PINCH_THRESHOLD = 16;
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

function startTwoFinger(first: Track, second: Track): Phase {
  return {
    kind: 'twoFinger',
    tracks: [first, second],
    intent: 'undecided',
    lastDistance: distance(first.last, second.last),
    lastCentroid: centroid(first.last, second.last),
    scrollRemainder: { x: 0, y: 0 },
  };
}

function track(pointer: PointerSample): Track {
  const point = { x: pointer.x, y: pointer.y };
  return { id: pointer.id, start: point, last: point, startTime: pointer.time };
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

function stepTouchDown(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext
): StepResult {
  const { phase } = state;
  const added = track(pointer);

  if (phase.kind === 'idle') {
    return {
      state: { ...state, phase: { kind: 'touchPending', track: added } },
      effects: context.sendsInput
        ? [{ type: 'armLongPress', id: pointer.id }]
        : [],
    };
  }

  if (phase.kind === 'touchPending') {
    return {
      state: { ...state, phase: startTwoFinger(phase.track, added) },
      effects: [{ type: 'cancelLongPress' }],
    };
  }

  if (phase.kind === 'touchDrag') {
    // A second finger turns a guest drag into a viewport gesture: release the
    // button where the drag got to first.
    const release = phase.panning
      ? []
      : pointerInput(context, phase.track.last, 0, true);
    return {
      state: { ...state, phase: startTwoFinger(phase.track, added) },
      effects: release,
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

function stepTouchMove(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext
): StepResult {
  const { phase } = state;
  const point = { x: pointer.x, y: pointer.y };

  if (phase.kind === 'touchPending' && phase.track.id === pointer.id) {
    if (distance(point, phase.track.start) < TAP_SLOP) {
      return { state, effects: [] };
    }

    const moved = { ...phase.track, last: point };
    if (context.sendsInput) {
      // The drag starts where the finger went down, not where it crossed the slop.
      const effects: GestureEffect[] = [
        { type: 'cancelLongPress' },
        ...pointerInput(context, phase.track.start, 0, false),
        ...pointerInput(context, phase.track.start, RFB_LEFT, false),
        ...pointerInput(context, point, RFB_LEFT, true),
      ];
      return {
        state: {
          ...state,
          phase: { kind: 'touchDrag', track: moved, panning: false },
        },
        effects,
      };
    }

    const viewport = panBy(
      context.geometry,
      context.viewport,
      point.x - phase.track.start.x,
      point.y - phase.track.start.y
    );
    return {
      state: {
        ...state,
        phase: { kind: 'touchDrag', track: moved, panning: true },
      },
      effects: [{ type: 'viewport', viewport }],
    };
  }

  if (phase.kind === 'touchDrag' && phase.track.id === pointer.id) {
    const moved = { ...phase.track, last: point };
    const nextState = { ...state, phase: { ...phase, track: moved } };
    if (phase.panning) {
      const viewport = panBy(
        context.geometry,
        context.viewport,
        point.x - phase.track.last.x,
        point.y - phase.track.last.y
      );
      return { state: nextState, effects: [{ type: 'viewport', viewport }] };
    }
    return {
      state: nextState,
      effects: pointerInput(context, point, RFB_LEFT, true),
    };
  }

  if (phase.kind === 'twoFinger') {
    return stepTwoFingerMove(state, phase, pointer, context);
  }

  return { state, effects: [] };
}

function stepTwoFingerMove(
  state: GestureState,
  phase: Extract<Phase, { kind: 'twoFinger' }>,
  pointer: PointerSample,
  context: GestureContext
): StepResult {
  const point = { x: pointer.x, y: pointer.y };
  const index = phase.tracks.findIndex((each) => each.id === pointer.id);
  if (index === -1) return { state, effects: [] };

  const tracks: [Track, Track] = [phase.tracks[0], phase.tracks[1]];
  tracks[index] = { ...tracks[index], last: point };
  const currentDistance = distance(tracks[0].last, tracks[1].last);
  const currentCentroid = centroid(tracks[0].last, tracks[1].last);

  // Decide once per gesture: a pinch if the fingers spread or close first,
  // a swipe if they move together first. Without control a swipe pans.
  let intent = phase.intent;
  if (intent === 'undecided') {
    const startDistance = distance(tracks[0].start, tracks[1].start);
    const startCentroid = centroid(tracks[0].start, tracks[1].start);
    if (Math.abs(currentDistance - startDistance) > PINCH_THRESHOLD) {
      intent = 'pinch';
    } else if (distance(currentCentroid, startCentroid) > TAP_SLOP) {
      intent = context.sendsInput ? 'scroll' : 'pinch';
    }
  }

  const base = {
    ...phase,
    tracks,
    intent,
    lastDistance: currentDistance,
    lastCentroid: currentCentroid,
  };

  if (intent === 'pinch') {
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
      state: { ...state, phase: base },
      effects: [{ type: 'viewport', viewport }],
    };
  }

  if (intent === 'scroll') {
    // Natural scrolling: fingers moving up scroll the page down.
    const travelX =
      phase.scrollRemainder.x + (phase.lastCentroid.x - currentCentroid.x);
    const travelY =
      phase.scrollRemainder.y + (phase.lastCentroid.y - currentCentroid.y);
    const horizontal = notches(travelX, TOUCH_SCROLL_STEP);
    const vertical = notches(travelY, TOUCH_SCROLL_STEP);
    return {
      state: {
        ...state,
        phase: {
          ...base,
          scrollRemainder: { x: horizontal.rest, y: vertical.rest },
        },
      },
      effects: scrollInput(
        context,
        currentCentroid,
        horizontal.count,
        vertical.count
      ),
    };
  }

  // Still undecided: remember where we were measured from.
  return {
    state: {
      ...state,
      phase: {
        ...base,
        lastDistance: phase.lastDistance,
        lastCentroid: phase.lastCentroid,
      },
    },
    effects: [],
  };
}

function stepTouchUp(
  state: GestureState,
  pointer: PointerSample,
  context: GestureContext,
  cancelled: boolean
): StepResult {
  const { phase } = state;
  const point = { x: pointer.x, y: pointer.y };
  const idle: GestureState = { ...state, phase: { kind: 'idle' } };

  if (phase.kind === 'touchPending' && phase.track.id === pointer.id) {
    if (cancelled) {
      return { state: idle, effects: [{ type: 'cancelLongPress' }] };
    }
    if (context.sendsInput) {
      return {
        state: idle,
        effects: [
          { type: 'cancelLongPress' },
          ...click(context, phase.track.start, RFB_LEFT),
        ],
      };
    }
    return stepViewportTap(idle, point, pointer.time, context);
  }

  if (phase.kind === 'touchDrag' && phase.track.id === pointer.id) {
    const release = phase.panning
      ? []
      : pointerInput(context, phase.track.last, 0, true);
    return { state: idle, effects: release };
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

/** A tap without control: a quick second tap toggles between fit and zoomed in. */
function stepViewportTap(
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
  if (phase.kind !== 'touchPending' || phase.track.id !== id) {
    return { state, effects: [] };
  }
  if (!context.sendsInput) return { state, effects: [] };

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
