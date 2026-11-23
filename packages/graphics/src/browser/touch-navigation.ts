import type { GraphicsEditor } from '../core/editor';
import type { Point } from '../core/model';
import { createGlide, type FingerPair, pinchStep } from '../pan-zoom';

/** A glide only follows when the last finger lifts this soon after the pair broke up. */
const GLIDE_RELEASE_MS = 150;
/** How far back the pair's last moments are read to tell a pinch from a pan. */
const PINCH_WINDOW_MS = 160;
/** How long one finger rests before it is a long press, and how far it may drift. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
/**
 * A hand shifts as it settles on the glass. Where one finger pans, it does so
 * only once it has moved further than this from where it landed.
 */
const PAN_SLOP_PX = 10;
/** How long after a long press lifts the browser's click for it may still come. */
const LIFT_CLICK_MS = 500;

const insideEditableText = (target: Element) =>
  target.closest('[contenteditable]')?.getAttribute('contenteditable') ===
  'true';

/**
 * A browser clicks whatever is under a finger as it lifts. Under a finger that
 * long-pressed, that is what the host opened for the press (a menu, with a row
 * there), and the browser clicks it although the press itself was cancelled.
 * The lift belongs to the long press, so the mouse events and the click the
 * browser makes for it stop here. A script's own `click()` is not the finger's
 * and passes.
 *
 * Not every lift is followed by a click: a browser sends none once the hold is
 * too long to be a tap. So this ends with the click, with the next press or
 * key, or a moment after the lift, whichever comes first.
 */
function swallowLiftClick() {
  const listening = new AbortController();
  const { signal } = listening;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    listening.abort();
  };
  const swallow = (event: Event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click') stop();
  };
  for (const type of ['mousedown', 'mouseup', 'click'])
    window.addEventListener(type, swallow, { capture: true, signal });
  window.addEventListener('keydown', stop, { capture: true, signal });
  return {
    /** The finger is up: its click comes now or not at all. */
    lifted() {
      if (!signal.aborted) timer ??= setTimeout(stop, LIFT_CLICK_MS);
    },
    /**
     * A press is its own, and so is what it clicks. A finger landing beside
     * the one that long-pressed is not a new press: that one has yet to lift.
     */
    pressed(event: PointerEvent) {
      if (timer !== undefined || event.isPrimary) stop();
    },
    stop,
  };
}

/**
 * Two fingers navigate, whatever the tool: their midpoint pans the camera and
 * their spread zooms around it, and letting go glides to a stop.
 *
 * One finger still belongs to the tool. When a second lands, whatever the first
 * started (a marquee, a move, a stroke, a connector, an erase, a text box) is
 * void, and the selection goes back to what it was before that finger landed.
 * Navigation then runs until every finger has lifted; a finger left behind
 * does nothing.
 *
 * A pen or a mouse pressed on the surface keeps its gesture: fingers landing
 * meanwhile do not navigate. Beside a pen they are the hand holding it (a
 * resting palm), so no tool hears of them either. A pen also takes the
 * surface from fingers that got there first: whatever they started is void,
 * and they do nothing more until they have lifted.
 *
 * Where the host says fingers pan (`fingerPans`), one finger moves the camera
 * the way two do, once it has moved far enough not to be a hand settling, and
 * the tool never sees it.
 *
 * One finger held still is a long press when the host has a use for it. It
 * voids the first finger's gesture the same way, and the finger then does
 * nothing more: not before it lifts, and not by lifting.
 *
 * The listeners sit on the window's capture phase so they see every touch on
 * the surface, including the ones a tool handler stops from propagating.
 */
export function attachTouchNavigation(
  element: HTMLElement,
  editor: GraphicsEditor,
  options: {
    ignoreTarget?: (target: EventTarget | null) => boolean;
    navigation?: 'free' | 'centered-image';
    longPress?: () => ((point: Point) => void) | undefined;
    fingerPans?: () => boolean;
  } = {}
) {
  // Fingers on the surface in the order they landed, in client coordinates.
  const touches = new Map<number, Point>();
  let navigating = false;
  // The two fingers driving the camera, and where they were at the last step.
  let pair: { ids: readonly [number, number]; points: FingerPair } | undefined;
  // The one finger that pans, where fingers pan: where it landed, and whether
  // it has moved far enough from there to be panning.
  let alone: { id: number; landed: Point; panning: boolean } | undefined;
  let pairEndedAt = Number.NEGATIVE_INFINITY;
  // Where the pair's midpoint has been lately and how far apart its fingers
  // were, to tell a pinch from a pan.
  let recent: { time: number; center: Point; spread: number }[] = [];
  let selectionBefore: readonly string[] = [];
  let voiding = false;
  // The system took a finger away mid-gesture, which is not a flick.
  let cancelled = false;
  // Pens and mice pressed on the surface, and which of the two each is.
  const otherPointers = new Map<number, string>();
  const penPressed = () => [...otherPointers.values()].includes('pen');
  // Fingers the pen took the surface from or landed beside, which are the
  // hand holding it: nothing hears of them until they lift.
  const ignored = new Set<number>();
  let longPress:
    | { id: number; origin: Point; timer: ReturnType<typeof setTimeout> }
    | undefined;

  const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer);
    longPress = undefined;
  };
  // What the lift of the last long press would click.
  let liftClick: ReturnType<typeof swallowLiftClick> | undefined;

  const glide = createGlide((delta) => {
    editor.panBy(delta);
    return delta;
  });

  const pairPoints = (ids: readonly [number, number]) => {
    const a = touches.get(ids[0]);
    const b = touches.get(ids[1]);
    if (!a || !b) return undefined;
    const rect = element.getBoundingClientRect();
    const points: FingerPair = [
      { x: a.x - rect.left, y: a.y - rect.top },
      { x: b.x - rect.left, y: b.y - rect.top },
    ];
    return points;
  };

  const choosePair = () => {
    const [first, second] = touches.keys();
    pair = undefined;
    if (first === undefined || second === undefined) return;
    const ids = [first, second] as const;
    const points = pairPoints(ids);
    if (!points) return;
    pair = { ids, points };
    // A new pair starts its own record; a pair that just broke up keeps its
    // record until the last finger lifts and the glide is decided.
    recent = [];
  };

  const swallow = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Every single-finger gesture already ends on a pointercancel, which is what
  // the browser sends when it takes a touch over for its own pan or zoom. This
  // surface opts out of that (`touch-action: none`) and navigates itself, so it
  // tells the gesture owners the same way.
  const voidSingleFingerGesture = (landing?: number) => {
    voiding = true;
    for (const id of touches.keys()) {
      if (id === landing) continue;
      element.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: id,
          pointerType: 'touch',
          bubbles: true,
        })
      );
    }
    voiding = false;
    editor.cancelShape();
    editor.cancelTransform();

    const selected = editor.getSession().selectedIds;
    const unchanged =
      selected.length === selectionBefore.length &&
      selected.every((id, index) => id === selectionBefore[index]);
    if (!unchanged) editor.selectMany(selectionBefore);
  };

  /** Move the camera by what the pair did since the last step. */
  const navigate = (time: number) => {
    if (!pair) return;
    const next = pairPoints(pair.ids);
    if (!next) return;
    const step = pinchStep(pair.points, next);
    pair = { ids: pair.ids, points: next };
    glide.track(step.center, time);
    recent.push({
      time,
      center: step.center,
      spread: Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y),
    });
    while (recent.length > 1 && time - recent[0]!.time > PINCH_WINDOW_MS)
      recent.shift();

    if (options.navigation === 'centered-image') {
      editor.centerImage(
        { width: element.clientWidth, height: element.clientHeight },
        editor.getCamera().scale * step.zoom
      );
      return;
    }
    editor.panZoomBy(step.pan, step.center, step.zoom);
  };

  // Each finger reports its own moves, so two fingers ask twice a frame. The
  // camera moves once per frame, to where both fingers are by then: every move
  // of it re-lays out the whole scene.
  let frame: number | undefined;
  let frameTime = 0;
  const navigateNextFrame = (time: number) => {
    frameTime = time;
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      navigate(frameTime);
    });
  };
  const dropFrame = () => {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
  };

  /**
   * A pinch does not fling. With one finger still and the other spreading, the
   * midpoint travels too, at half the speed the spread changes; two fingers
   * panning together move the midpoint and barely change their spread. So the
   * pair was pinching as it broke up if its spread changed more than its
   * midpoint travelled.
   */
  const wasPinching = () => {
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (!first || !last) return false;
    const travel = Math.hypot(
      last.center.x - first.center.x,
      last.center.y - first.center.y
    );
    return Math.abs(last.spread - first.spread) > travel;
  };

  /** Nothing the fingers now down do counts until they have landed again. */
  const forgetFingers = () => {
    touches.clear();
    navigating = false;
    pair = undefined;
    alone = undefined;
  };

  /**
   * A pen has landed among fingers. What one finger had started with the tool
   * is void, as it is when a second finger lands, and navigation stops where
   * it is.
   */
  const yieldToPen = () => {
    cancelLongPress();
    dropFrame();
    glide.reset();
    if (!navigating) voidSingleFingerGesture();
    for (const id of touches.keys()) ignored.add(id);
    forgetFingers();
  };

  /**
   * The first finger of a gesture. Where fingers pan it navigates on its own
   * and the tool never hears of it. Otherwise it is the tool's, and a long
   * press if it stays still and the host has a use for one.
   */
  const firstFingerLanded = (event: PointerEvent, point: Point) => {
    if (options.fingerPans?.()) {
      swallow(event);
      navigating = true;
      alone = { id: event.pointerId, landed: point, panning: false };
      glide.reset();
      return;
    }

    const onLongPress = options.longPress?.();
    if (!onLongPress) return;
    const pressed = () => {
      longPress = undefined;
      // From here the finger is spent: it neither finishes what it started
      // nor begins anything else before it lifts.
      navigating = true;
      voidSingleFingerGesture();
      liftClick = swallowLiftClick();
      onLongPress(point);
    };
    longPress = {
      id: event.pointerId,
      origin: point,
      timer: setTimeout(pressed, LONG_PRESS_MS),
    };
  };

  const pointerDown = (event: PointerEvent) => {
    // Any press catches a glide in flight.
    glide.cancel();
    liftClick?.pressed(event);
    const target = event.target;
    if (!(target instanceof Element) || !element.contains(target)) return;
    if (event.pointerType !== 'touch') {
      otherPointers.set(event.pointerId, event.pointerType);
      if (event.pointerType === 'pen' && touches.size) yieldToPen();
      return;
    }
    if (insideEditableText(target) || options.ignoreTarget?.(target)) return;
    // A pen or mouse has the surface, and fingers do not navigate under it.
    // Beside a pen the finger is the hand holding it, so no tool hears of it
    // either: a host's tool might not ignore a second pointer as the
    // surface's own gestures do.
    if (otherPointers.size) {
      if (!penPressed()) return;
      ignored.add(event.pointerId);
      swallow(event);
      return;
    }

    // A primary touch is the first finger down, so anything still tracked is a
    // finger whose release never arrived.
    if (event.isPrimary) {
      ignored.clear();
      forgetFingers();
    }
    if (!touches.size) cancelled = false;
    if (!touches.size) selectionBefore = editor.getSession().selectedIds;

    const point = { x: event.clientX, y: event.clientY };
    touches.set(event.pointerId, point);
    cancelLongPress();
    if (touches.size < 2) {
      firstFingerLanded(event, point);
      return;
    }

    swallow(event);
    alone = undefined;
    if (!navigating) {
      navigating = true;
      voidSingleFingerGesture(event.pointerId);
    }
    if (!pair) {
      choosePair();
      glide.reset();
    }
  };

  const pointerMove = (event: PointerEvent) => {
    // A pen or mouse whose release never arrived shows up with no button held.
    if (otherPointers.has(event.pointerId) && !event.buttons)
      otherPointers.delete(event.pointerId);
    if (ignored.has(event.pointerId)) {
      swallow(event);
      return;
    }
    const from = touches.get(event.pointerId);
    if (!from) return;
    const to = { x: event.clientX, y: event.clientY };
    touches.set(event.pointerId, to);
    if (longPress?.id === event.pointerId) {
      const drift = Math.hypot(
        event.clientX - longPress.origin.x,
        event.clientY - longPress.origin.y
      );
      if (drift > LONG_PRESS_SLOP_PX) cancelLongPress();
    }
    if (!navigating) return;

    swallow(event);
    if (pair?.ids.includes(event.pointerId)) navigateNextFrame(event.timeStamp);
    if (alone?.id !== event.pointerId) return;

    if (alone.panning) {
      glide.track(to, event.timeStamp);
      editor.panBy({ x: to.x - from.x, y: to.y - from.y });
      return;
    }
    // Panning starts from here, not from where the finger landed, so the
    // canvas does not jump by the distance it took to tell.
    const moved = Math.hypot(to.x - alone.landed.x, to.y - alone.landed.y);
    if (moved <= PAN_SLOP_PX) return;
    alone = { ...alone, panning: true };
    glide.track(to, event.timeStamp);
  };

  /**
   * The last navigating finger is up. The canvas glides on if that was a
   * flick. One finger flicks only if it was panning, and its lift is a sample
   * too, so a finger that stops before lifting carries less speed into the
   * glide, and none once it has rested longer than the glide looks back. A
   * pair has to have lifted together, and not out of a pinch.
   */
  const lastFingerLifted = (event: PointerEvent) => {
    navigating = false;
    liftClick?.lifted();
    const lone = alone?.id === event.pointerId ? alone : undefined;
    alone = undefined;
    if (lone?.panning && event.type === 'pointerup')
      glide.track({ x: event.clientX, y: event.clientY }, event.timeStamp);
    const pairFlicked =
      event.timeStamp - pairEndedAt <= GLIDE_RELEASE_MS && !wasPinching();
    const flicked = !cancelled && (lone ? lone.panning : pairFlicked);
    if (flicked && options.navigation !== 'centered-image') glide.release();
    else glide.reset();
  };

  const pointerEnd = (event: PointerEvent) => {
    otherPointers.delete(event.pointerId);
    if (voiding) return;
    if (ignored.delete(event.pointerId)) {
      swallow(event);
      return;
    }
    if (!touches.has(event.pointerId)) return;
    if (longPress?.id === event.pointerId) cancelLongPress();
    if (!navigating) {
      touches.delete(event.pointerId);
      return;
    }

    swallow(event);
    if (event.type === 'pointercancel') cancelled = true;
    if (pair?.ids.includes(event.pointerId)) {
      // The step below takes the fingers as they are now, so the frame that
      // was waiting has nothing left to do. A finger that is not of the pair
      // leaves that frame alone: the pair's last move is still owed.
      dropFrame();
      // Take the lifting finger's last position (a cancelled touch reports
      // none), then hand over to the next pair if a third finger is still down.
      if (event.type === 'pointerup')
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      navigate(event.timeStamp);
      touches.delete(event.pointerId);
      choosePair();
      if (pair) glide.reset();
      else pairEndedAt = event.timeStamp;
    } else {
      touches.delete(event.pointerId);
    }
    if (!touches.size) lastFingerLifted(event);
  };

  // A surface that leaves one finger to the page lets the browser pan it
  // (`touch-action: pan-x pan-y`), with any number of fingers. Two fingers
  // are for the canvas: say so before the browser starts scrolling with them.
  const touchMove = (event: TouchEvent) => {
    if (navigating && event.cancelable) event.preventDefault();
  };
  // Fingers on the surface, by their touch events. The browser takes a
  // finger's pointer events away once it scrolls the page with it, and the
  // finger is still there.
  let fingers = 0;
  const countFingers = (event: TouchEvent) => {
    fingers = event.targetTouches.length;
  };
  const wheel = () => glide.cancel();
  // A press released in another window never reports its release here. Forget
  // it, or a mouse that went away pressed would keep fingers from navigating.
  const blur = () => otherPointers.clear();

  window.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('pointermove', pointerMove, true);
  window.addEventListener('pointerup', pointerEnd, true);
  window.addEventListener('pointercancel', pointerEnd, true);
  element.addEventListener('wheel', wheel, { passive: true });
  element.addEventListener('touchmove', touchMove, { passive: false });
  element.addEventListener('touchstart', countFingers, { passive: true });
  element.addEventListener('touchend', countFingers, { passive: true });
  element.addEventListener('touchcancel', countFingers, { passive: true });
  window.addEventListener('blur', blur);

  return {
    /** Touches are down on the surface, so a WebKit gesture event duplicates them. */
    tracking: () => touches.size > 0 || fingers > 0,
    detach() {
      glide.cancel();
      dropFrame();
      cancelLongPress();
      liftClick?.stop();
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchstart', countFingers);
      element.removeEventListener('touchend', countFingers);
      element.removeEventListener('touchcancel', countFingers);
      window.removeEventListener('blur', blur);
    },
  };
}
