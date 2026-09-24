import { screenToWorld } from '../core/camera';
import type { GraphicsEditor } from '../core/editor';
import type { Appearance, ShapeKind } from '../core/model';
import {
  isResizeHandle,
  type ResizeHandle,
  resizeHandles,
} from '../core/resize';
import {
  type SelectionFrame,
  selectionContainsPoint,
  selectionFrame,
} from '../core/selection-frame';
import { isShapeKind } from '../core/shapes/registry';

export { type LocalImage, loadLocalImage } from './local-image';

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

export type GraphicsInputOptions = {
  tool?: () => 'pan' | ShapeKind | 'select';
  editing?: boolean;
  duplicateOnAltDrag?: boolean;
  onShapeCreated?: (id: string) => void;
  navigation?: 'free' | 'centered-image';
  createId?: () => string;
  appearance?: () => Appearance;
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
        mode: 'pan' | 'shape' | 'transform' | 'box';
        cursor?: string;
      }
    | undefined;
  const originalCursor = element.style.cursor;

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
    const id = drag?.id;
    drag = undefined;
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
  const transformModifiers = (
    event: Pick<PointerEvent, 'shiftKey' | 'altKey'>
  ) => ({
    proportional: event.shiftKey,
    fromCenter: event.altKey,
    snapRotation: event.shiftKey,
  });
  const updateModifierPreview = (event: KeyboardEvent) => {
    if (
      drag?.mode !== 'transform' ||
      (event.key !== 'Shift' && event.key !== 'Alt')
    )
      return;
    event.preventDefault();
    editor.updateTransform(
      worldPoint({ clientX: drag.x, clientY: drag.y }),
      transformModifiers(event)
    );
  };
  const pointerDown = (event: PointerEvent) => {
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
    if (drag) return;
    const pan =
      options.navigation !== 'centered-image' &&
      (event.button === 1 ||
        (event.button === 0 && (space || options.tool?.() === 'pan')));
    const tool = options.tool?.();
    const drawing = event.button === 0 && !pan && isShapeKind(tool);
    const selecting =
      event.button === 0 && !pan && options.tool?.() === 'select';
    let transforming = false;
    let boxing = false;
    let cursor: string | undefined;
    if (selecting) {
      const target = event.target instanceof Element ? event.target : undefined;
      const handle = target
        ?.closest('[data-graphics-handle]')
        ?.getAttribute('data-graphics-handle');
      const transformHandle =
        isResizeHandle(handle) || handle === 'rotate' ? handle : undefined;
      const point = worldPoint(event);
      const deep = options.duplicateOnAltDrag
        ? event.metaKey || event.ctrlKey
        : event.altKey;
      const frame = selectionFrame(
        editor.document,
        editor.getSession().selectedIds
      );
      // Shift still toggles/adds to selection, and the deep-select modifier
      // still picks children. Ordinary clicks anywhere inside move the selection.
      const insideSelection =
        !event.shiftKey &&
        !deep &&
        frame &&
        selectionContainsPoint(frame, point);
      const id =
        transformHandle || insideSelection
          ? editor.getSession().selectedIds[0]
          : editor.hitTest(point, deep);
      cursor =
        transformHandle === 'rotate'
          ? 'grabbing'
          : transformHandle
            ? resizeCursor(transformHandle, frame)
            : 'move';
      if (id && event.shiftKey && !transformHandle) {
        event.preventDefault();
        editor.toggleSelection(id);
        return;
      }
      if (id)
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
    if (!pan && !drawing && !transforming && !boxing) return;
    if (
      drawing &&
      isShapeKind(tool) &&
      !editor.beginShape(tool, worldPoint(event))
    )
      return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: pan ? 'pan' : transforming ? 'transform' : boxing ? 'box' : 'shape',
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
    if (drag.mode === 'shape') editor.updateShape(worldPoint(event));
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
    if (drag.mode === 'box') {
      editor.updateBoxSelection(worldPoint(event));
      editor.commitBoxSelection();
    }
    if (drag.mode === 'transform') {
      editor.updateTransform(worldPoint(event), transformModifiers(event));
      editor.commitTransform();
    }
    if (drag.mode === 'shape') {
      editor.updateShape(worldPoint(event));
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
      const exponent = Math.max(-1, Math.min(1, -event.deltaY * unit * 0.01));
      editor.zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        editor.getCamera().scale * Math.exp(exponent)
      );
    } else {
      editor.panBy({ x: -event.deltaX * unit, y: -event.deltaY * unit });
    }
  };
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('keydown', keyDown);
  element.addEventListener('keyup', keyUp);
  element.addEventListener('blur', cancel);
  element.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('keydown', keyDown);
    element.removeEventListener('keyup', keyUp);
    element.removeEventListener('blur', cancel);
    element.removeEventListener('wheel', wheel);
    window.removeEventListener('blur', cancel);
    element.style.cursor = originalCursor;
  };
}
