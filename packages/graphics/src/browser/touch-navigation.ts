import type { GraphicsEditor } from '../core/editor';
import type { Point } from '../core/model';
import { createGlide, type FingerPair, pinchStep } from '../pan-zoom';

/** A glide only follows a release this soon after the fingers stopped panning. */
const GLIDE_RELEASE_MS = 150;

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
  let pairEndedAt = 0;
  let selectionBefore: readonly string[] = [];
  let voiding = false;

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
    if (points) pair = { ids, points };
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

    if (options.navigation === 'centered-image') {
      editor.centerImage(
        { width: element.clientWidth, height: element.clientHeight },
        editor.getCamera().scale * step.zoom
      );
      return;
    }
    editor.panZoomBy(step.pan, step.center, step.zoom);
  };

  const pointerDown = (event: PointerEvent) => {
    // Any press catches a glide in flight.
    glide.cancel();
    const target = event.target;
    if (
      event.pointerType !== 'touch' ||
      !(target instanceof Element) ||
      !element.contains(target) ||
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
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!navigating) return;

    swallow(event);
    if (pair?.ids.includes(event.pointerId)) navigate(event.timeStamp);
  };

  const pointerEnd = (event: PointerEvent) => {
    if (voiding || !touches.has(event.pointerId)) return;
    if (!navigating) {
      touches.delete(event.pointerId);
      return;
    }

    swallow(event);
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
    const flicked = event.timeStamp - pairEndedAt <= GLIDE_RELEASE_MS;
    if (flicked && options.navigation !== 'centered-image') glide.release();
    else glide.reset();
  };

  const wheel = () => glide.cancel();

  window.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('pointermove', pointerMove, true);
  window.addEventListener('pointerup', pointerEnd, true);
  window.addEventListener('pointercancel', pointerEnd, true);
  element.addEventListener('wheel', wheel, { passive: true });

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
    },
  };
}
