import { screenToWorld } from '../core/camera';
import type { ConnectorStyle } from '../core/connector-commands';
import type { createConnectorInteraction } from '../core/connector-interaction';
import type { GraphicsEditor } from '../core/editor';
import type { Appearance } from '../core/model';

/** Endpoint capture is independent of shape drawing and document history. */
export function attachConnectorControls(
  element: HTMLElement,
  editor: GraphicsEditor,
  options: {
    interaction: ReturnType<typeof createConnectorInteraction>;
    active(): boolean;
    appearance(): Appearance;
    style(): ConnectorStyle;
    onCommit(): void;
    createId?: () => string;
  }
) {
  const op = options.interaction;
  let pointer: number | undefined,
    space = false;
  let last: { clientX: number; clientY: number; shiftKey: boolean } | undefined;
  const worldPoint = (event: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };
  const update = () => {
    if (last)
      op.update(worldPoint(last), 14 / editor.getCamera().scale, last.shiftKey);
  };
  const cleanupPointer = () => {
    if (pointer !== undefined && element.hasPointerCapture(pointer))
      element.releasePointerCapture(pointer);
    pointer = undefined;
    last = undefined;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
  };
  const cancel = () => {
    cleanupPointer();
    op.cancel();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    last = {
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
    };
    update();
    event.preventDefault();
  };
  const hover = (event: PointerEvent) => {
    if (pointer !== undefined) return;
    if (options.active() && !space && !event.buttons)
      op.hover(worldPoint(event), 14 / editor.getCamera().scale);
    else op.clearHover();
  };
  const leave = () => op.clearHover();
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    last = {
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
    };
    update();
    cleanupPointer();
    if (op.commit(3 / editor.getCamera().scale)) options.onCommit();
    else if (options.active() && !space)
      op.hover(worldPoint(event), 14 / editor.getCamera().scale);
    event.preventDefault();
    event.stopPropagation();
  };
  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      space ||
      !(event.target instanceof Element) ||
      event.target.closest('[contenteditable],input,textarea')
    )
      return;
    const handle = event.target.closest('[data-graphics-connector-end]');
    if (!options.active() && !handle) return;
    const id = handle?.getAttribute('data-graphics-connector-id'),
      end = handle?.getAttribute('data-graphics-connector-end');
    editor.cancelShape();
    editor.cancelTransform();
    if (id && (end === 'start' || end === 'end')) {
      editor.select(id);
      if (!op.edit(id, end)) return;
      op.hover(worldPoint(event), 14 / editor.getCamera().scale);
    } else {
      editor.select();
      op.begin(
        (options.createId ?? (() => crypto.randomUUID()))(),
        worldPoint(event),
        options.appearance(),
        options.style(),
        14 / editor.getCamera().scale
      );
    }
    pointer = event.pointerId;
    last = {
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
    };
    element.focus({ preventScroll: true });
    element.setPointerCapture(pointer);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    event.preventDefault();
    event.stopPropagation();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[contenteditable],input,textarea')
    )
      return;
    if (event.code === 'Space') {
      space = true;
      op.clearHover();
    }
    if (event.key === 'Escape' && pointer !== undefined) {
      cancel();
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === 'Shift' && last) {
      last = { ...last, shiftKey: true };
      update();
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') space = false;
    if (event.key === 'Shift' && last) {
      last = { ...last, shiftKey: false };
      update();
    }
  };
  const blur = () => {
    space = false;
    cancel();
  };
  element.addEventListener('pointerdown', down, true);
  element.addEventListener('pointermove', hover);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  const unsubscribe = editor.subscribeDocument(cancel),
    camera = editor.subscribeCamera(cancel);
  return () => {
    cancel();
    unsubscribe();
    camera();
    element.removeEventListener('pointerdown', down, true);
    element.removeEventListener('pointermove', hover);
    element.removeEventListener('pointerleave', leave);
    element.removeEventListener('keydown', keyDown, true);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
  };
}
