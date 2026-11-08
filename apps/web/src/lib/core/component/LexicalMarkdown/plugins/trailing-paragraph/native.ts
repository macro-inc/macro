import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import { dispatchApplicationCommand } from '../group-b/command';

/** Geometry is a view fact; Rust rechecks adjacency and block eligibility. */
export function registerNativeTrailingParagraph(view: EditorView): () => void {
  const needsCaret = (node: ViewNode) =>
    node.type === 'code' ||
    node.type === 'custom-code' ||
    node.type === 'table' ||
    (node.kind === 'decorator' && view.flags(node)?.isInline === false);
  const click = (event: MouseEvent) => {
    if (
      view.root.contentEditable !== 'true' ||
      event.button !== 0 ||
      event.defaultPrevented ||
      event.target !== view.root
    )
      return;
    const children = view.node(0)?.children ?? [];
    for (const [index, key] of children.entries()) {
      const nextKey = children.at(index + 1);
      if (nextKey === undefined) break;
      const previous = view.node(key);
      const next = view.node(nextKey);
      if (!previous || !next || !needsCaret(previous) || !needsCaret(next))
        continue;
      const previousElement = view.getElementByKey(key);
      const nextElement = view.getElementByKey(nextKey);
      if (!previousElement || !nextElement) continue;
      const previousRect = previousElement.getBoundingClientRect();
      const nextRect = nextElement.getBoundingClientRect();
      if (event.clientY > previousRect.bottom && event.clientY < nextRect.top) {
        event.preventDefault();
        dispatchApplicationCommand(view, 'group-b.move', {
          action: 'gap',
          previous: key,
          next: nextKey,
        });
        view.focus();
        return;
      }
    }
  };
  view.root.addEventListener('click', click);
  return () => view.root.removeEventListener('click', click);
}
