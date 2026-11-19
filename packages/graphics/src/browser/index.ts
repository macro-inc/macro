import { screenToWorld, worldToScreen } from '../core/camera';
import type { DrawingKind } from '../core/drawing';
import type { GraphicsEditor } from '../core/editor';
import type { Appearance, Point } from '../core/model';
import { isRadiusHandle } from '../core/radius';
import {
  isResizeHandle,
  type ResizeHandle,
  resizeHandles,
} from '../core/resize';
import { PICK_TOLERANCE, roots } from '../core/scene';
import {
  type SelectionFrame,
  selectionContainsPoint,
  selectionFrame,
} from '../core/selection-frame';
import {
  rotationKnobOffset,
  rotationKnobPoint,
  touchHandleAt,
} from '../core/selection-handles';
import { isShape, isShapeKind } from '../core/shapes/registry';
import { selectionTarget } from './selection-target';
import { attachTouchNavigation } from './touch-navigation';

// Matches the Figma viewer: pinch tracks finger speed, wheel notches stay bounded.
const WHEEL_ZOOM_RATE = 0.01;
const MAX_WHEEL_ZOOM_EXPONENT = 0.6;
/**
 * How near a stroke a finger still picks its shape, in screen pixels, when it
 * lands on nothing. A cursor gets `PICK_TOLERANCE`.
 */
const TOUCH_PICK_REACH = 10;

export function resizeCursor(handle: ResizeHandle, frame?: SelectionFrame) {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  const corner = frame?.corners[resizeHandles.indexOf(handle)];
  // Local corner names survive rotation and reflection; use their world quadrant.
  const descending =
    frame && corner
      ? (corner.x - frame.center.x) * (corner.y - frame.center.y) >= 0
      : handle === 'nw' || handle === 'se';
  return descending ? 'nwse-resize' : 'nesw-resize';
}

export type GraphicsHover = Readonly<{
  point: Point;
  deep: boolean;
  additive: boolean;
  handle: boolean;
}>;
export type GraphicsInputOptions = {
  tool?: () => 'pan' | DrawingKind | 'select';
  /** False permits navigation and selection, but never document changes. */
  editing?: boolean;
  suspended?: () => boolean;
  /** Host-owned controls may keep their pointer events without starting a gesture. */
  ignoreTarget?: (target: EventTarget | null) => boolean;
  duplicateOnAltDrag?: boolean;
  onShapeCreated?: (id: string) => void;
  navigation?: 'free' | 'centered-image';
  createId?: () => string;
  appearance?: () => Appearance;
  /** Local viewport position and picking modifiers; never document/awareness state. */
  onHover?: (hover: GraphicsHover | undefined) => void;
  /**
   * What a finger held still on the surface does, given where it is in client
   * coordinates. Return nothing while a long press has no meaning (a drawing
   * tool, say) and the press stays with the tool. The finger's lift clicks
   * nothing, so a menu may open under it.
   */
  longPress?: () => ((point: Point) => void) | undefined;
  /**
   * One finger pans instead of going to the tool, as two already do, once it
   * has moved far enough not to be a hand settling. A host answers yes while a
   * pen does the drawing, so that the hand holding it leaves no marks. Asked
   * as the first finger lands.
   */
  fingerPans?: () => boolean;
  /**
   * Lay the selection's handles out for fingers: the rotation knob stands
   * further off the frame, and corner-radius handles are left to the host's
   * inspector. Fingers get larger handle targets whether or not this is set.
   */
  touchHandles?: boolean;
  /**
   * Leave one finger, a pen and the plain wheel to the page. A surface inside
   * a scrolling document sets this until the person asks to interact with it:
   * swipes and the wheel scroll the document, while two fingers (and a pinch
   * or Ctrl/Cmd wheel) still move the canvas. A mouse works as ever.
   */
  yieldToPage?: () => boolean;
};

/** Attach camera controls to a focusable viewport. No document-global keyboard shortcuts. */
export function attachCameraControls(
  element: HTMLElement,
  editor: GraphicsEditor,
  options: GraphicsInputOptions = {}
): () => void {
  let space = false;
  let drag:
    | {
        id: number;
        x: number;
        y: number;
        mode: 'pan' | 'shape' | 'transform' | 'box' | 'select';
        cursor?: string;
      }
    | undefined;
  // A press that becomes a transform only once it moves.
  let pendingSelection:
    | {
        id: string;
        point: Point;
        /** Released without moving, it toggles `id` in the selection. */
        toggle: boolean;
        duplicate?: () => string;
        /** The handle the movement drags, for a finger near one. */
        handle?: ResizeHandle | 'rotate';
        /**
         * What a finger that only tapped near a handle selects instead: an
         * item, or nothing (`null`). Absent, the selection stays.
         */
        tap?: string | null;
      }
    | undefined;
  const originalCursor = element.style.cursor;
  const touchNavigation = attachTouchNavigation(element, editor, {
    ignoreTarget: options.ignoreTarget,
    navigation: options.navigation,
    longPress: options.longPress,
    fingerPans: options.fingerPans,
  });
  let hoverPointer: PointerEvent | undefined;
  const clearHover = () => {
    hoverPointer = undefined;
    options.onHover?.(undefined);
  };
  const updateHover = (
    modifiers: Pick<PointerEvent, 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>
  ) => {
    const event = hoverPointer;
    if (
      !event ||
      drag ||
      space ||
      event.buttons ||
      event.pointerType === 'touch'
    ) {
      options.onHover?.(undefined);
      return;
    }
    const rect = element.getBoundingClientRect();
    options.onHover?.({
      point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      deep: options.duplicateOnAltDrag
        ? modifiers.metaKey || modifiers.ctrlKey
        : modifiers.altKey,
      additive: modifiers.shiftKey,
      handle:
        event.target instanceof Element &&
        !!event.target.closest('[data-graphics-handle]'),
    });
  };
  const pointerHover = (event: PointerEvent) => {
    hoverPointer = event;
    updateHover(event);
  };

  const updateCursor = () => {
    element.style.cursor =
      drag?.mode === 'pan'
        ? 'grabbing'
        : drag?.mode === 'transform'
          ? (drag.cursor ?? 'move')
          : space || options.tool?.() === 'pan'
            ? 'grab'
            : isShapeKind(options.tool?.())
              ? 'crosshair'
              : originalCursor;
  };
  const cancel = () => {
    clearHover();
    const id = drag?.id;
    drag = undefined;
    pendingSelection = undefined;
    window.removeEventListener('pointermove', pointerMove, true);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('pointercancel', pointerEnd, true);
    editor.cancelShape();
    editor.cancelTransform();
    space = false;
    if (id !== undefined && element.hasPointerCapture(id))
      element.releasePointerCapture(id);
    updateCursor();
  };
  const worldPoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = element.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };
  const sample = (event: PointerEvent) => ({
    ...worldPoint(event),
    ...(event.pointerType === 'pen' && Number.isFinite(event.pressure)
      ? { pressure: event.pressure }
      : {}),
  });
  const updateDrawing = (event: PointerEvent) => {
    const coalesced = event.getCoalescedEvents?.() ?? [];
    editor.updateDrawing((coalesced.length ? coalesced : [event]).map(sample), {
      proportional: event.shiftKey,
    });
  };
  const transformModifiers = (
    event: Pick<PointerEvent, 'shiftKey' | 'altKey'>
  ) => ({
    proportional: event.shiftKey,
    fromCenter: event.altKey,
    snapRotation: event.shiftKey,
    constrainAxis: event.shiftKey,
  });
  const updateModifierPreview = (event: KeyboardEvent) => {
    if (!drag || (event.key !== 'Shift' && event.key !== 'Alt')) return;
    if (drag.mode === 'transform') {
      event.preventDefault();
      editor.updateTransform(
        worldPoint({ clientX: drag.x, clientY: drag.y }),
        transformModifiers(event)
      );
    } else if (
      drag.mode === 'shape' &&
      editor.getDrawingKind() !== 'pencil' &&
      event.key === 'Shift'
    ) {
      event.preventDefault();
      editor.updateDrawing([], { proportional: event.shiftKey });
    }
  };
  /**
   * Whether a press outside the selection's frame lands on the paint of an
   * item that is not selected. Such a press is for that item, however near
   * the selection's handles it is.
   */
  const pressesAnotherItem = (
    frame: SelectionFrame | undefined,
    point: Point
  ) => {
    if (!frame || selectionContainsPoint(frame, point)) return false;
    const hit = editor.hitTest(point, true);
    if (!hit) return false;
    const selected = editor.getSession().selectedIds;
    // A hit on anything inside a selected group is a hit on the selection.
    return (
      !selected.includes(hit) &&
      roots(editor.document, [...selected, hit]).includes(hit)
    );
  };
  /**
   * The handle a finger takes when it lands near the selection's frame. The
   * handles are drawn for a cursor; a finger takes them from further away.
   */
  const touchHandle = (
    frame: SelectionFrame | undefined,
    event: Pick<PointerEvent, 'clientX' | 'clientY'>
  ) => {
    const selected = roots(editor.document, editor.getSession().selectedIds);
    const first = selected[0] ? editor.document.items[selected[0]] : undefined;
    // Read-only surfaces and a lone connector show no handles to reach for.
    if (!frame || options.editing === false) return undefined;
    if (selected.length === 1 && first?.type === 'connector') return undefined;

    const camera = editor.getCamera();
    const rect = element.getBoundingClientRect();
    const corners = frame.corners.map((corner) =>
      worldToScreen(camera, corner)
    );
    const knob = rotationKnobPoint(
      corners,
      selected.length === 1 && isShape(first),
      rotationKnobOffset(options.touchHandles)
    );
    return touchHandleAt(corners, knob, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };
  /** The handle drawn under a press, by its name. */
  const drawnHandle = (target: EventTarget | null) => {
    const handle =
      target instanceof Element
        ? target
            .closest('[data-graphics-handle]')
            ?.getAttribute('data-graphics-handle')
        : undefined;
    return isResizeHandle(handle) ||
      isRadiusHandle(handle) ||
      handle === 'rotate'
      ? handle
      : undefined;
  };
  /**
   * The handle a press takes, given the one `drawn` under it. A finger near
   * the frame takes the handle it is nearest, which can be a corner while it
   * covers the strip drawn along an edge. Only paint that belongs to something
   * else ends that reach.
   */
  const pressedHandle = (
    drawn: ReturnType<typeof drawnHandle>,
    event: PointerEvent,
    frame: SelectionFrame | undefined,
    point: Point
  ) => {
    if (
      event.pointerType !== 'touch' ||
      isRadiusHandle(drawn) ||
      pressesAnotherItem(frame, point)
    )
      return drawn;
    // Where the reach finds no handle there is none for a finger, whatever is
    // drawn under it: the strips along a thin shape's edges cover its middle,
    // which moves it.
    return touchHandle(frame, event);
  };
  /**
   * A finger resizes or rotates once it moves. One that only taps near a handle
   * must not resize by nothing (which still fixes the width of auto-width
   * text).
   */
  const waitsForMovement = (
    event: PointerEvent,
    handle: ReturnType<typeof drawnHandle>
  ): handle is ResizeHandle | 'rotate' =>
    event.pointerType === 'touch' &&
    (isResizeHandle(handle) || handle === 'rotate');
  /** What a release without movement does with the press that was waiting. */
  const settlePendingTap = () => {
    const pending = pendingSelection;
    if (!pending) return;
    if (pending.toggle) editor.toggleSelection(pending.id);
    if (pending.tap) editor.select(pending.tap);
    else if (pending.tap === null) editor.selectMany([]);
  };
  const pointerDown = (event: PointerEvent) => {
    // A pen pans the page like a finger does; only a mouse cannot.
    if (options.yieldToPage?.() && event.pointerType !== 'mouse') return;
    if (
      options.suspended?.() ||
      options.ignoreTarget?.(event.target) ||
      (event.target instanceof Element &&
        event.target
          .closest('[contenteditable]')
          ?.getAttribute('contenteditable') === 'true')
    )
      return;
    if (
      event.target !== element &&
      !(
        event.target instanceof Element &&
        event.target.closest(
          '[data-graphics-item], [data-graphics-handle], [data-graphics-selection-bounds]'
        )
      )
    )
      return;
    element.focus({ preventScroll: true });
    clearHover();
    if (drag) return;
    const pan =
      options.navigation !== 'centered-image' &&
      (event.button === 1 ||
        (event.button === 0 && (space || options.tool?.() === 'pan')));
    const tool = options.tool?.();
    const drawing =
      options.editing !== false &&
      event.button === 0 &&
      !pan &&
      isShapeKind(tool);
    const selecting =
      event.button === 0 && !pan && options.tool?.() === 'select';
    let transforming = false;
    let boxing = false;
    let cursor: string | undefined;
    if (selecting) {
      const point = worldPoint(event);
      const deep = options.duplicateOnAltDrag
        ? event.metaKey || event.ctrlKey
        : event.altKey;
      const frame = selectionFrame(
        editor.document,
        editor.getSession().selectedIds
      );
      const touch = event.pointerType === 'touch';
      const drawn = drawnHandle(event.target);
      const transformHandle = pressedHandle(drawn, event, frame, point);
      const { scale } = editor.getCamera();
      const pick = (handle: boolean) =>
        selectionTarget(
          editor.document,
          editor.getSession().selectedIds,
          point,
          {
            deep,
            additive: event.shiftKey,
            handle,
            tolerance: PICK_TOLERANCE / scale,
            reach: touch ? TOUCH_PICK_REACH / scale : undefined,
          }
        );
      const id = pick(!!transformHandle);
      cursor =
        transformHandle === 'rotate' || isRadiusHandle(transformHandle)
          ? 'grabbing'
          : transformHandle
            ? resizeCursor(transformHandle, frame)
            : 'move';
      const shiftTarget =
        id ??
        (!deep && frame && selectionContainsPoint(frame, point)
          ? editor.getSession().selectedIds[0]
          : undefined);
      if (options.editing === false) {
        if (id) {
          if (event.shiftKey) editor.toggleSelection(id);
          else editor.select(id);
          event.preventDefault();
          return;
        }
        boxing = editor.beginBoxSelection(point, event.shiftKey);
      } else if (shiftTarget && event.shiftKey && !transformHandle) {
        // Defer Shift-click toggling until release so Shift-drag can move instead.
        pendingSelection = {
          id: shiftTarget,
          point,
          toggle: !!id,
          duplicate:
            options.duplicateOnAltDrag && event.altKey
              ? (options.createId ?? (() => crypto.randomUUID()))
              : undefined,
        };
      } else if (id && waitsForMovement(event, transformHandle)) {
        // Released without moving, a press outside the frame was a tap on
        // whatever is there; one inside it leaves the selection as it is.
        const outside =
          !drawn && !!frame && !selectionContainsPoint(frame, point);
        pendingSelection = {
          id,
          point,
          toggle: false,
          handle: transformHandle,
          tap: outside ? (pick(false) ?? null) : undefined,
        };
      } else if (id)
        transforming = editor.beginTransform(
          id,
          worldPoint(event),
          transformHandle,
          options.duplicateOnAltDrag && event.altKey && !transformHandle
            ? (options.createId ?? (() => crypto.randomUUID()))
            : undefined
        );
      else boxing = editor.beginBoxSelection(worldPoint(event), event.shiftKey);
    }
    if (!pan && !drawing && !transforming && !boxing && !pendingSelection)
      return;
    if (drawing && isShapeKind(tool) && !editor.beginShape(tool, sample(event)))
      return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: pan
        ? 'pan'
        : pendingSelection
          ? 'select'
          : transforming
            ? 'transform'
            : boxing
              ? 'box'
              : 'shape',
      cursor,
    };
    // Capture can be lost before pointerup. Keep ownership of this pointer until
    // release or an actual cancellation, even over another widget or viewport.
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    updateCursor();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.mode === 'select') {
      const pending = pendingSelection;
      if (
        !pending ||
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3
      )
        return;
      if (!editor.getSession().selectedIds.includes(pending.id))
        editor.toggleSelection(pending.id);
      if (
        !editor.beginTransform(
          pending.id,
          pending.point,
          pending.handle,
          pending.duplicate
        )
      ) {
        cancel();
        return;
      }
      pendingSelection = undefined;
      drag = { ...drag, mode: 'transform' };
      updateCursor();
    }
    if (drag.mode === 'shape') updateDrawing(event);
    else if (drag.mode === 'box') editor.updateBoxSelection(worldPoint(event));
    else if (drag.mode === 'transform')
      editor.updateTransform(worldPoint(event), transformModifiers(event));
    else editor.panBy({ x: event.clientX - drag.x, y: event.clientY - drag.y });
    drag = { ...drag, x: event.clientX, y: event.clientY };
  };
  const pointerEnd = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) cancel();
  };
  const pointerUp = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    if (drag.mode === 'select') pointerMove(event);
    if (!drag) return;
    if (drag.mode === 'select') settlePendingTap();
    if (drag.mode === 'box') {
      editor.updateBoxSelection(worldPoint(event));
      editor.commitBoxSelection();
    }
    if (drag.mode === 'transform') {
      editor.updateTransform(worldPoint(event), transformModifiers(event));
      editor.commitTransform();
    }
    if (drag.mode === 'shape') {
      updateDrawing(event);
      const id = options.createId?.() ?? crypto.randomUUID();
      const committed = editor.commitShape(
        id,
        options.appearance?.() ?? { fill: 'transparent', stroke: '#e53935' },
        3 / editor.getCamera().scale
      );
      if (committed) options.onShapeCreated?.(id);
    }
    cancel();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (options.suspended?.()) return;
    if (event.target !== element) return;
    updateModifierPreview(event);
    if (event.code === 'Space' && options.navigation !== 'centered-image') {
      event.preventDefault();
      space = true;
      updateCursor();
    }
    if (event.key === 'Escape') {
      const active = !!drag;
      cancel();
      if (!active) editor.select();
    }
    if (options.editing && !event.repeat) {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
        event.preventDefault();
        cancel();
        if (key === 'y' || event.shiftKey) editor.redo();
        else editor.undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        cancel();
        editor.deleteSelection();
      }
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.target === element) updateModifierPreview(event);
    if (event.code === 'Space') {
      space = false;
      updateCursor();
    }
  };
  const wheel = (event: WheelEvent) => {
    if (options.suspended?.()) return;
    // The page scrolls, unless this is a pinch or a deliberate zoom.
    if (options.yieldToPage?.() && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (drag) return;
    const rect = element.getBoundingClientRect();
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element.clientHeight
          : 1;
    if (options.navigation === 'centered-image') {
      const exponent = Math.max(-1, Math.min(1, -event.deltaY * unit * 0.01));
      editor.centerImage(
        { width: element.clientWidth, height: element.clientHeight },
        editor.getCamera().scale * Math.exp(exponent)
      );
    } else if (event.ctrlKey || event.metaKey) {
      // Keep fine trackpad deltas continuous and bound coarse wheel/page jumps.
      const exponent = Math.max(
        -MAX_WHEEL_ZOOM_EXPONENT,
        Math.min(
          MAX_WHEEL_ZOOM_EXPONENT,
          -event.deltaY * unit * WHEEL_ZOOM_RATE
        )
      );
      editor.zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        editor.getCamera().scale * Math.exp(exponent)
      );
    } else {
      editor.panBy({ x: -event.deltaX * unit, y: -event.deltaY * unit });
    }
  };
  // WebKit (Safari, the desktop app) reports trackpad pinches as gesture events
  // with a running scale instead of ctrl+wheel. It also sends them for fingers
  // on a touchscreen, which touch navigation already follows.
  let gestureScale = 1;
  const gestureStart = (event: Event) => {
    event.preventDefault();
    gestureScale = 1;
  };
  const gestureChange = (event: Event) => {
    event.preventDefault();
    const gesture = event as Event & {
      scale: number;
      clientX: number;
      clientY: number;
    };
    const factor = gesture.scale / gestureScale;
    gestureScale = gesture.scale;
    if (options.suspended?.() || drag || touchNavigation.tracking()) return;
    const camera = editor.getCamera();
    if (options.navigation === 'centered-image') {
      editor.centerImage(
        { width: element.clientWidth, height: element.clientHeight },
        camera.scale * factor
      );
      return;
    }
    const rect = element.getBoundingClientRect();
    editor.zoomAt(
      { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top },
      camera.scale * factor
    );
  };
  // The browser scrolls the surface to reveal a caret that left it: text being
  // typed past an edge, or behind an on-screen keyboard. A scrolled surface no
  // longer matches the camera, so every press would land beside its target.
  // Take the scroll as a pan and put the surface back.
  const scrolled = () => {
    const { scrollLeft, scrollTop } = element;
    if (!scrollLeft && !scrollTop) return;
    element.scrollLeft = 0;
    element.scrollTop = 0;
    if (options.navigation !== 'centered-image')
      editor.panBy({ x: -scrollLeft, y: -scrollTop });
  };
  element.addEventListener('scroll', scrolled);
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('pointermove', pointerHover);
  element.addEventListener('pointerup', pointerHover);
  element.addEventListener('pointerleave', clearHover);
  element.addEventListener('keydown', keyDown);
  element.addEventListener('keyup', keyUp);
  element.addEventListener('blur', cancel);
  element.addEventListener('wheel', wheel, { passive: false });
  element.addEventListener('gesturestart', gestureStart);
  element.addEventListener('gesturechange', gestureChange);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', updateHover);
  window.addEventListener('keyup', updateHover);
  return () => {
    cancel();
    touchNavigation.detach();
    element.removeEventListener('scroll', scrolled);
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('pointermove', pointerHover);
    element.removeEventListener('pointerup', pointerHover);
    element.removeEventListener('pointerleave', clearHover);
    element.removeEventListener('keydown', keyDown);
    element.removeEventListener('keyup', keyUp);
    element.removeEventListener('blur', cancel);
    element.removeEventListener('wheel', wheel);
    element.removeEventListener('gesturestart', gestureStart);
    element.removeEventListener('gesturechange', gestureChange);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', updateHover);
    window.removeEventListener('keyup', updateHover);
    element.style.cursor = originalCursor;
  };
}

export { attachConnectorControls } from './connectors';
export {
  createTextMeasurer,
  textFonts,
  textLayoutStyle,
} from './rich-text';
