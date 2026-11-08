import { EditorView } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

/** Touch geometry only; native policy moves each item with its complete nested group. */
export function registerNativeListSwipeIndent(
  view: EditorView,
  isInteractable: () => boolean
): () => void {
  const document = view.root.ownerDocument;
  let active = true;
  let endGesture: (() => void) | undefined;
  const down = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      event.isPrimary === false ||
      !isInteractable() ||
      view.root.contentEditable !== 'true' ||
      event.clientX < 16 ||
      !(event.target instanceof Node) ||
      EditorView.fromDOM(event.target) !== view
    )
      return;
    let key = view.keyFromDOM(event.target);
    while (key !== null && view.node(key)?.type !== 'listitem')
      key = view.node(key)?.parent ?? null;
    if (key === null) return;
    endGesture?.();
    const item = key;
    const generation = view.mirror.keyGeneration;
    const { clientX: x, clientY: y, pointerId } = event;
    let claimed = false;
    let dx = 0;
    const blockScroll = (event: TouchEvent) => event.preventDefault();
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('touchmove', blockScroll);
      endGesture = undefined;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      dx = event.clientX - x;
      const dy = event.clientY - y;
      if (claimed || (Math.abs(dx) < 12 && Math.abs(dy) < 12)) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        cleanup();
        return;
      }
      claimed = true;
      document.addEventListener('touchmove', blockScroll, { passive: false });
      try {
        view.root.setPointerCapture(pointerId);
      } catch {
        /* Synthetic pointers cannot be captured. */
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      cleanup();
      if (!claimed || Math.abs(dx) < 40) return;
      queueMicrotask(() => {
        if (
          !active ||
          !view.isMounted ||
          !isInteractable() ||
          view.root.contentEditable !== 'true' ||
          view.mirror.keyGeneration !== generation
        )
          return;
        dispatchApplicationCommand(view, 'group-b.move', {
          action: 'swipe',
          key: item,
          outdent: dx < 0,
        });
      });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cleanup);
    endGesture = cleanup;
  };
  document.addEventListener('pointerdown', down, true);
  return () => {
    active = false;
    endGesture?.();
    document.removeEventListener('pointerdown', down, true);
  };
}
