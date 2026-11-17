import { screenToWorld, textTargetAt } from '@macro-inc/graphics';
import type { CanvasState } from './create-canvas-state';
/** Canvas text gestures stay separate from geometric drawing and pointer capture. */
export function attachTextInput(root: HTMLElement, state: CanvasState) {
  let space = false;
  type Tap = { x: number; y: number; time: number; id: number };
  let pendingTap: Tap | undefined, lastTap: Tap | undefined;
  const closeTo = (tap: Tap, event: PointerEvent) =>
    Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 4;
  const trackMove = (event: PointerEvent) => {
    if (pendingTap?.id === event.pointerId && !closeTo(pendingTap, event))
      pendingTap = undefined;
  };
  const trackUp = (event: PointerEvent) => {
    if (pendingTap?.id !== event.pointerId) return;
    lastTap = closeTo(pendingTap, event)
      ? { ...pendingTap, time: event.timeStamp }
      : undefined;
    pendingTap = undefined;
  };
  // A Text tool press, waiting for its release. `target` is the text or
  // labelled shape under it; without one the release starts new text.
  let origin:
    | {
        x: number;
        y: number;
        id: number;
        touch: boolean;
        target: string | undefined;
      }
    | undefined;
  // A pen or mouse press waiting for its release keeps the tool: a palm that
  // lands beside the pen must not take the press over. The other way round, the
  // pen takes it from a palm that was already resting.
  const heldByPenOrMouse = () => origin !== undefined && !origin.touch;
  const canvas = () =>
    root.querySelector<HTMLElement>('[aria-label="Graphics canvas"]');
  const point = (x: number, y: number) => {
    const rect = canvas()!.getBoundingClientRect();
    return screenToWorld(state.editor.getCamera(), {
      x: x - rect.left,
      y: y - rect.top,
    });
  };
  const editAt = (p: { x: number; y: number }) => {
    // Pointer capture can retarget dblclick to the viewport rather than a card.
    // Resolve the document reference geometrically before creating canvas text.
    const hit = state.editor.hitTest(p);
    const item = hit ? state.editor.document.items[hit] : undefined;
    if (item?.type === 'document') {
      if (item.geometry.display === 'embed') state.embeds.enter(item.id);
      return;
    }
    if (item?.type === 'artifact') {
      state.embeds.enter(item.id);
      return;
    }
    const id = textTargetAt(state.editor.document, p);
    if (id) state.text.edit(id);
    else state.text.begin(p);
  };
  const down = (event: PointerEvent) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        '[data-canvas-document], [data-canvas-artifact], [data-canvas-text-editor], [aria-label="Text style"]'
      )
    )
      return;
    const wasEditing = !!state.text.draft();
    state.text.finish();
    // Captured shape gestures can change the click target between taps, so a
    // native dblclick is not guaranteed. Track completed, stationary taps too.
    if (
      !wasEditing &&
      !space &&
      event.button === 0 &&
      !event.shiftKey &&
      !event.altKey &&
      state.tool() === 'select' &&
      target.closest('[aria-label="Graphics canvas"]') &&
      !target.closest('[data-graphics-handle], [data-graphics-connector-end]')
    ) {
      const double =
        lastTap &&
        event.timeStamp - lastTap.time < 450 &&
        closeTo(lastTap, event);
      lastTap = undefined;
      if (double) {
        pendingTap = undefined;
        editAt(point(event.clientX, event.clientY));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      pendingTap = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        id: event.pointerId,
      };
    } else {
      pendingTap = undefined;
      lastTap = undefined;
    }
    if (
      space ||
      event.button !== 0 ||
      state.tool() !== 'text' ||
      !target.closest('[aria-label="Graphics canvas"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const touch = event.pointerType === 'touch';
    if (touch && heldByPenOrMouse()) return;
    // Editing starts on release, never on the press: a press that is cancelled
    // (a second finger landing to pinch or pan) must not open an editor.
    origin = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      touch,
      target: textTargetAt(
        state.editor.document,
        point(event.clientX, event.clientY)
      ),
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
  };
  const cancel = () => {
    origin = undefined;
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', pointerCancel, true);
  };
  // Only the press's own pointer ends it: a palm the system takes away must not
  // drop the pen's press.
  const pointerCancel = (event: PointerEvent) => {
    if (event.pointerId === origin?.id) cancel();
  };
  const up = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.id) return;
    const { target } = origin;
    const start = point(origin.x, origin.y),
      end = point(event.clientX, event.clientY);
    const width =
      Math.abs(event.clientX - origin.x) > 3
        ? Math.max(40, Math.abs(end.x - start.x))
        : undefined;
    cancel();
    event.stopPropagation();
    if (target) {
      state.text.edit(target);
      return;
    }
    state.text.begin(
      { x: width ? Math.min(start.x, end.x) : start.x, y: start.y },
      width
    );
  };
  const doubleClick = (event: MouseEvent) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(
        '[data-canvas-document], [data-canvas-artifact], [data-canvas-text-editor], [data-graphics-connector-end]'
      ) ||
      !event.target.closest('[aria-label="Graphics canvas"]')
    )
      return;
    if (state.tool() !== 'select' && state.tool() !== 'text') return;
    editAt(point(event.clientX, event.clientY));
    event.preventDefault();
    event.stopPropagation();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (state.embeds.active()) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        '[contenteditable]:not([contenteditable="false"]),input,select'
      )
    )
      return;
    if (event.code === 'Space') space = true;
    if (event.key === 'Escape') cancel();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') space = false;
  };
  const blur = () => {
    pendingTap = undefined;
    lastTap = undefined;
    space = false;
    cancel();
  };
  const anyPointerCancel = (event: PointerEvent) => {
    pendingTap = undefined;
    lastTap = undefined;
    space = false;
    pointerCancel(event);
  };
  root.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  window.addEventListener('pointermove', trackMove, true);
  window.addEventListener('pointerup', trackUp, true);
  window.addEventListener('pointercancel', anyPointerCancel);
  root.addEventListener('pointerdown', down, true);
  root.addEventListener('dblclick', doubleClick, true);
  return () => {
    cancel();
    root.removeEventListener('keydown', keyDown, true);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
    window.removeEventListener('pointermove', trackMove, true);
    window.removeEventListener('pointerup', trackUp, true);
    window.removeEventListener('pointercancel', anyPointerCancel);
    root.removeEventListener('pointerdown', down, true);
    root.removeEventListener('dblclick', doubleClick, true);
  };
}
