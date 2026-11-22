import type { EditorView } from '@macro-inc/lexical-wasm-view';

/** Route only the owned key; native listeners resolve all command priorities. */
export function registerNativeNormalizeEnter(view: EditorView): () => void {
  return view.registerKeyRoute((event) => {
    if (
      event.key !== 'Enter' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    )
      return null;
    return { name: 'group-b.key', json: 'null' };
  });
}
