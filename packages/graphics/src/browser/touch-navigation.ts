import type { GraphicsEditor } from '../core/editor';
import type { Point } from '../core/model';
import { createGlide, type FingerPair, pinchStep } from '../pan-zoom';

/** A glide only follows when the last finger lifts this soon after the pair broke up. */
const GLIDE_RELEASE_MS = 150;
/** How far back the pair's last moments are read to tell a pinch from a pan. */
const PINCH_WINDOW_MS = 160;

const insideEditableText = (target: Element) =>
  target.closest('[contenteditable]')?.getAttribute('contenteditable') ===
  'true';

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
 * meanwhile (a resting palm) are ignored, as they were before fingers navigated.
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
  } = {}
) {
  // Fingers on the surface in the order they landed, in client coordinates.
  const touches = new Map<number, Point>();
  let navigating = false;
  // The two fingers driving the camera, and where they were at the last step.
  let pair: { ids: readonly [number, number]; points: FingerPair } | undefined;
  let pairEndedAt = Number.NEGATIVE_INFINITY;
  // Where the pair's midpoint has been lately and how far apart its fingers
  // were, to tell a pinch from a pan.
  let recent: { time: number; center: Point; spread: number }[] = [];
  let selectionBefore: readonly string[] = [];
  let voiding = false;
  // The system took a finger away mid-gesture, which is not a flick.
  let cancelled = false;
  // Pens and mice pressed on the surface.
  const otherPointers = new Set<number>();

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
  const voidSingleFingerGesture = (landing: number) => {
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

  const pointerDown = (event: PointerEvent) => {
    // Any press catches a glide in flight.
    glide.cancel();
    const target = event.target;
    if (!(target instanceof Element) || !element.contains(target)) return;
    if (event.pointerType !== 'touch') {
      otherPointers.add(event.pointerId);
      return;
    }
    if (
      otherPointers.size ||
      insideEditableText(target) ||
      options.ignoreTarget?.(target)
    )
      return;

    // A primary touch is the first finger down, so anything still tracked is a
    // finger whose release never arrived.
    if (event.isPrimary) {
      touches.clear();
      navigating = false;
      pair = undefined;
    }
    if (!touches.size) cancelled = false;
    if (!touches.size) selectionBefore = editor.getSession().selectedIds;

    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size < 2) return;

    swallow(event);
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
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!navigating) return;

    swallow(event);
    if (pair?.ids.includes(event.pointerId)) navigate(event.timeStamp);
  };

  const pointerEnd = (event: PointerEvent) => {
    otherPointers.delete(event.pointerId);
    if (voiding || !touches.has(event.pointerId)) return;
    if (!navigating) {
      touches.delete(event.pointerId);
      return;
    }

    swallow(event);
    if (event.type === 'pointercancel') cancelled = true;
    if (pair?.ids.includes(event.pointerId)) {
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
    if (touches.size) return;

    navigating = false;
    const flicked =
      !cancelled &&
      event.timeStamp - pairEndedAt <= GLIDE_RELEASE_MS &&
      !wasPinching();
    if (flicked && options.navigation !== 'centered-image') glide.release();
    else glide.reset();
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
  window.addEventListener('blur', blur);

  return {
    /** Touches are down on the surface, so a WebKit gesture event duplicates them. */
    tracking: () => touches.size > 0,
    detach() {
      glide.cancel();
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
    },
  };
}
