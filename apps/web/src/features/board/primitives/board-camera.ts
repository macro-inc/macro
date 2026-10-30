import { debounce } from '@core/util/debounce';
import { createElementSize } from '@solid-primitives/resize-observer';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  type Bounds,
  type Camera,
  fitCamera,
  type Point,
  wheelZoomFactor,
  ZOOM_STEP,
  zoomCameraAt,
} from '../core/camera';

const IDENTITY: Camera = { x: 0, y: 0, scale: 1 };

/** Gestures that start inside these are the node's, not the board's. */
const NODE_SELECTOR = '[data-board-node], [data-board-overlay]';

/** WebKit's `GestureEvent`, which the DOM typings leave out. */
type WebKitGesture = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

function isWebKitGesture(event: Event): event is WebKitGesture {
  return (
    'scale' in event &&
    typeof event.scale === 'number' &&
    'clientX' in event &&
    typeof event.clientX === 'number' &&
    'clientY' in event &&
    typeof event.clientY === 'number'
  );
}

/**
 * The board's camera. Until the viewer pans or zooms it frames the whole
 * layout, following it as items arrive; after that it stays where they put
 * it (and is remembered) until they zoom to fit again.
 *
 * Wheel pans, pinch (Ctrl/⌘-wheel, or WebKit gesture events) zooms at the
 * pointer, dragging empty board pans, and two touch points pinch-zoom.
 */
export function createBoardCamera(options: {
  saved: Accessor<Camera | undefined>;
  bounds: Accessor<Bounds | undefined>;
  onSave: (camera: Camera | undefined) => void;
  /** The scale an automatic fit stops at, so a few items stay legible. */
  maxFitScale?: number;
}) {
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const size = createElementSize(viewport);
  const [manual, setManual] = createSignal<Camera | undefined>(options.saved());
  const [panning, setPanning] = createSignal(false);

  const viewportSize = () => ({
    width: size.width ?? 0,
    height: size.height ?? 0,
  });

  // A plain derivation, not a memo: `bounds` may read a layout that is
  // built after the camera, so nothing here may run during construction.
  const fitted = () => {
    const bounds = options.bounds();
    const view = viewportSize();
    if (!bounds || view.width === 0) return undefined;
    return fitCamera(bounds, view, {
      maxScale: options.maxFitScale ?? 1,
      padding: 56,
    });
  };

  const camera = (): Camera => manual() ?? fitted() ?? IDENTITY;

  const save = debounce((next: Camera) => options.onSave(next), 400);
  onCleanup(() => save.clear());

  const set = (next: Camera) => {
    setManual(next);
    save(next);
  };

  const center = (): Point => {
    const view = viewportSize();
    return { x: view.width / 2, y: view.height / 2 };
  };

  const zoomBy = (factor: number, anchor: Point = center()) =>
    set(zoomCameraAt(camera(), anchor, factor));

  const panBy = (dx: number, dy: number) => {
    const current = camera();
    set({ ...current, x: current.x + dx, y: current.y + dy });
  };

  /** Stops following the layout, e.g. while the viewer arranges nodes. */
  const hold = () => {
    if (!manual()) set(camera());
  };

  /** Back to framing everything; forgets the saved camera. */
  const fit = () => {
    save.clear();
    setManual(undefined);
    options.onSave(undefined);
  };

  /** Centers a world rectangle, keeping the zoom unless it would not fit. */
  const reveal = (rect: Bounds) => {
    const view = viewportSize();
    const current = camera();
    const scale = Math.min(
      current.scale,
      (view.width - 96) / rect.width,
      (view.height - 96) / rect.height
    );
    set({
      x: view.width / 2 - (rect.x + rect.width / 2) * scale,
      y: view.height / 2 - (rect.y + rect.height / 2) * scale,
      scale,
    });
  };

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = viewport()?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), local(event));
      return;
    }
    const lines = event.deltaMode === 1 ? 16 : 1;
    const [dx, dy] = event.shiftKey
      ? [event.deltaY, event.deltaX]
      : [event.deltaX, event.deltaY];
    panBy(-dx * lines, -dy * lines);
  };

  // WebKit (Safari) reports trackpad pinches as gesture events with a
  // running scale instead of ctrl+wheel.
  let gestureScale = 1;
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    if (!isWebKitGesture(event)) return;
    const factor = event.scale / gestureScale;
    gestureScale = event.scale;
    zoomBy(factor, local(event));
  };

  // Active pointers on empty board, for one-finger pan and two-finger pinch.
  const pointers = new Map<number, Point>();
  let pinch: { distance: number; mid: Point } | undefined;

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    const onNode =
      event.target instanceof Element && event.target.closest(NODE_SELECTOR);
    // The middle button pans from anywhere, as in other canvases.
    if (onNode && event.button !== 1) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 2) pinch = pinchState();
    setPanning(true);
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2 && pinch) {
      const next = pinchState();
      const zoomed = zoomCameraAt(
        camera(),
        next.mid,
        next.distance / Math.max(1, pinch.distance)
      );
      set({
        ...zoomed,
        x: zoomed.x + next.mid.x - pinch.mid.x,
        y: zoomed.y + next.mid.y - pinch.mid.y,
      });
      pinch = next;
      return;
    }
    panBy(point.x - previous.x, point.y - previous.y);
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    pinch = pointers.size === 2 ? pinchState() : undefined;
    if (pointers.size === 0) setPanning(false);
  };

  /** Binds the viewport element: its size, wheel, and pointer gestures. */
  const bind = (element: HTMLElement) => {
    setViewport(element);
    // Wheel must be non-passive so pinch-zoom does not zoom the page.
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);
    onCleanup(() => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
    });
  };

  return {
    camera,
    bind,
    viewportSize,
    panning,
    isFitted: () => manual() === undefined,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    zoomBy,
    panBy,
    hold,
    fit,
    reveal,
  };
}

export type BoardCamera = ReturnType<typeof createBoardCamera>;
