import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';

export function nativeList(node: ViewNode | null): boolean {
  return node?.type === 'list' || node?.type === 'task-list';
}
/** Source block hit testing with collapsed margins and list wrapper ownership. */
export function nativeBlockAtY(
  view: EditorView,
  y: number,
  snapEdges = false
): HTMLElement | null {
  const keys = view.node(0)?.children ?? [];
  const firstKey = keys.at(0);
  const lastKey = keys.at(-1);
  const first = firstKey === undefined ? null : view.getElementByKey(firstKey);
  const last = lastKey === undefined ? null : view.getElementByKey(lastKey);
  if (snapEdges && first && y < first.getBoundingClientRect().top) return first;
  if (snapEdges && last && y > last.getBoundingClientRect().bottom) return last;
  for (const key of keys) {
    const element = view.getElementByKey(key);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const previous = element.previousElementSibling;
    const next = element.nextElementSibling;
    const top = Math.max(
      Number.parseFloat(style.marginTop),
      previous ? Number.parseFloat(getComputedStyle(previous).marginBottom) : 0
    );
    const bottom = Math.max(
      Number.parseFloat(style.marginBottom),
      next ? Number.parseFloat(getComputedStyle(next).marginTop) : 0
    );
    if (!(y >= rect.top - top && y <= rect.bottom + bottom)) continue;
    const node = view.node(key);
    if (!nativeList(node)) return element;
    let closest: HTMLElement | null = null;
    let closestDistance = Infinity;
    let closestWrapper = false;
    let lastReal: HTMLElement | null = null;
    for (const itemKey of node?.children ?? []) {
      const item = view.node(itemKey);
      const dom = view.getElementByKey(itemKey);
      if (item?.type !== 'listitem' || !dom) continue;
      const wrapper =
        item.children.length > 0 &&
        item.children.every((child) => nativeList(view.node(child)));
      const rect = dom.getBoundingClientRect();
      const distance = Math.abs(y - rect.top - rect.height / 2);
      if (!wrapper) lastReal = dom;
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = dom;
        closestWrapper = wrapper;
      }
    }
    return closestWrapper && lastReal ? lastReal : (closest ?? element);
  }
  return null;
}
