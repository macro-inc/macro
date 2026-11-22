import type { EditorView } from '@macro-inc/lexical-wasm-view';

/** Published DOM identity only; model actions retain their actual authority checks. */
export function nativeTableCellFromTarget(
  view: EditorView,
  target: EventTarget | null
): HTMLElement | undefined {
  const window = view.root.ownerDocument.defaultView;
  if (!window || !(target instanceof window.Node)) return;
  const element =
    target instanceof window.Element ? target : target.parentElement;
  const cell = element?.closest('td,th');
  if (!(cell instanceof window.HTMLElement) || !view.ownsEvent(cell, true))
    return;
  const key = view.keyFromDOM(cell);
  if (key === null || view.node(key)?.type !== 'tablecell') return;
  return cell;
}
