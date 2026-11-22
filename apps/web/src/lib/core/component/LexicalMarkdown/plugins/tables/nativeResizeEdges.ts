import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createNativeTableResizer } from './nativeResize';

/** Invisible pointer-device edge strips share the source's nine-pixel hit area. */
export function registerNativeTableResizeEdges(view: EditorView): () => void {
  const resizer = createNativeTableResizer(view);
  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      !view.ownsEvent(event.target, true)
    )
      return;
    const cell =
      event.target instanceof Element ? event.target.closest('td,th') : null;
    if (!(cell instanceof HTMLElement)) return;
    const rect = cell.getBoundingClientRect();
    const edges = [
      { edge: 'left', distance: Math.abs(event.clientX - rect.left) },
      { edge: 'right', distance: Math.abs(event.clientX - rect.right) },
      { edge: 'bottom', distance: Math.abs(event.clientY - rect.bottom) },
    ] as const;
    const nearest = [...edges].sort((a, b) => a.distance - b.distance)[0];
    if (
      !nearest ||
      nearest.distance > 9 ||
      !resizer.start(cell, nearest.edge, event, view.root)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  };
  view.root.addEventListener('pointerdown', down, true);
  return () => {
    view.root.removeEventListener('pointerdown', down, true);
    resizer.dispose();
  };
}
