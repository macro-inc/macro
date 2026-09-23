import { screenToWorld } from '../core/camera';
import type { GraphicsEditor } from '../core/editor';
import type { RectangleItem } from '../core/model';

export { type LocalImage, loadLocalImage } from './local-image';

export type GraphicsInputOptions = {
  tool?: () => 'pan' | 'rectangle' | 'select';
  editing?: boolean;
  navigation?: 'free' | 'centered-image';
  createId?: () => string;
  appearance?: () => RectangleItem['appearance'];
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
        mode: 'pan' | 'rectangle' | 'transform' | 'box';
      }
    | undefined;
  const originalCursor = element.style.cursor;

  const updateCursor = () => {
    element.style.cursor =
      drag?.mode === 'pan'
        ? 'grabbing'
        : space || options.tool?.() === 'pan'
          ? 'grab'
          : options.tool?.() === 'rectangle'
            ? 'crosshair'
            : originalCursor;
  };
  const cancel = () => {
    const id = drag?.id;
    drag = undefined;
    editor.cancelRectangle();
    editor.cancelTransform();
    space = false;
    if (id !== undefined && element.hasPointerCapture(id))
      element.releasePointerCapture(id);
    updateCursor();
  };
  const worldPoint = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };
  const pointerDown = (event: PointerEvent) => {
    if (
      event.target !== element &&
      !(
        event.target instanceof Element &&
        event.target.closest('[data-graphics-item], [data-graphics-handle]')
      )
    )
      return;
    element.focus({ preventScroll: true });
    if (drag) return;
    const pan =
      options.navigation !== 'centered-image' &&
      (event.button === 1 ||
        (event.button === 0 && (space || options.tool?.() === 'pan')));
    const rectangle =
      event.button === 0 && !pan && options.tool?.() === 'rectangle';
    const selecting =
      event.button === 0 && !pan && options.tool?.() === 'select';
    let transforming = false;
    let boxing = false;
    if (selecting) {
      const target = event.target instanceof Element ? event.target : undefined;
      const handle = target
        ?.closest('[data-graphics-handle]')
        ?.getAttribute('data-graphics-handle');
      const corner =
        handle === 'nw' ||
        handle === 'ne' ||
        handle === 'sw' ||
        handle === 'se' ||
        handle === 'rotate'
          ? handle
          : undefined;
      const id = corner
        ? editor.getSession().selectedIds[0]
        : editor.hitTest(worldPoint(event), event.altKey);
      if (id && event.shiftKey && !corner) {
        event.preventDefault();
        editor.toggleSelection(id);
        return;
      }
      if (id)
        transforming = editor.beginTransform(id, worldPoint(event), corner);
      else boxing = editor.beginBoxSelection(worldPoint(event), event.shiftKey);
    }
    if (!pan && !rectangle && !transforming && !boxing) return;
    if (rectangle && !editor.beginRectangle(worldPoint(event))) return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: pan
        ? 'pan'
        : transforming
          ? 'transform'
          : boxing
            ? 'box'
            : 'rectangle',
    };
    updateCursor();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.mode === 'rectangle') editor.updateRectangle(worldPoint(event));
    else if (drag.mode === 'box') editor.updateBoxSelection(worldPoint(event));
    else if (drag.mode === 'transform')
      editor.updateTransform(worldPoint(event));
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
      editor.updateTransform(worldPoint(event));
      editor.commitTransform();
    }
    if (drag.mode === 'rectangle') {
      editor.updateRectangle(worldPoint(event));
      editor.commitRectangle(
        options.createId?.() ?? crypto.randomUUID(),
        options.appearance?.() ?? { fill: 'transparent', stroke: '#e53935' },
        3 / editor.getCamera().scale
      );
    }
    cancel();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.target !== element) return;
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
  element.addEventListener('pointermove', pointerMove);
  element.addEventListener('pointerup', pointerUp);
  element.addEventListener('pointercancel', pointerEnd);
  element.addEventListener('lostpointercapture', pointerEnd);
  element.addEventListener('keydown', keyDown);
  element.addEventListener('keyup', keyUp);
  element.addEventListener('blur', cancel);
  element.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('pointermove', pointerMove);
    element.removeEventListener('pointerup', pointerUp);
    element.removeEventListener('pointercancel', pointerEnd);
    element.removeEventListener('lostpointercapture', pointerEnd);
    element.removeEventListener('keydown', keyDown);
    element.removeEventListener('keyup', keyUp);
    element.removeEventListener('blur', cancel);
    element.removeEventListener('wheel', wheel);
    window.removeEventListener('blur', cancel);
    element.style.cursor = originalCursor;
  };
}
