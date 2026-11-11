import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { NodeKey } from '@macro-inc/lexical-wasm-view/view/types';
import type { PersistentLocation } from './locationPlugin';

const HIGHLIGHT_MS = 2000;
const ELEMENT_WAIT_MS = 5000;

function scrollToCenter(element: HTMLElement) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Source GO_TO_LOCATION_COMMAND: scroll the focus node into the centre. */
export function nativeGoToLocation(
  view: EditorView,
  location: PersistentLocation
): boolean {
  const key = view.query.keyForNodeId(location.focus.id);
  if (key === null) return false;
  const element = view.getElementByKey(key);
  if (!element) return false;
  scrollToCenter(element);
  return true;
}

/**
 * Source GO_TO_NODE_ID_COMMAND: scroll to the node and flash `highlighted` on
 * its element, waiting up to five seconds for an unreconciled element.
 */
export function nativeGoToNodeId(view: EditorView, id: string): boolean {
  const key = view.query.keyForNodeId(id);
  if (key === null) return false;
  const scrollAndHighlight = (element: HTMLElement) => {
    scrollToCenter(element);
    element.classList.add('highlighted');
    setTimeout(() => element.classList.remove('highlighted'), HIGHLIGHT_MS);
  };
  const element = view.getElementByKey(key);
  if (element) {
    scrollAndHighlight(element);
    return true;
  }
  let release: (() => void) | undefined;
  const timeout = setTimeout(() => release?.(), ELEMENT_WAIT_MS);
  release = view.onCommit(() => {
    const retried = view.getElementByKey(key);
    if (!retried) return;
    clearTimeout(timeout);
    release?.();
    scrollAndHighlight(retried);
  });
  return true;
}

function textPoint(element: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    last = text as Text;
    if (remaining <= last.length) return [last, remaining];
    remaining -= last.length;
  }
  return last ? [last, last.length] : [element, 0];
}

function domPoint(
  view: EditorView,
  key: NodeKey,
  offset: number
): [Node, number] | null {
  const node = view.node(key);
  const element = view.getElementByKey(key);
  if (!node || !element) return null;
  if (node.kind === 'text') return textPoint(element, offset);
  const child = node.children[offset];
  const childElement = child === undefined ? null : view.getElementByKey(child);
  if (childElement?.parentNode) {
    const parent = childElement.parentNode;
    return [
      parent,
      Array.prototype.indexOf.call(parent.childNodes, childElement),
    ];
  }
  return [element, element.childNodes.length];
}

/** The DOM range a persistent location covers in the native view. */
export function nativeLocationRange(
  view: EditorView,
  location: PersistentLocation
): Range | null {
  const anchorKey = view.query.keyForNodeId(location.anchor.id);
  const focusKey = view.query.keyForNodeId(location.focus.id);
  if (anchorKey === null || focusKey === null) return null;
  const anchor = domPoint(view, anchorKey, location.anchor.offset);
  const focus = domPoint(view, focusKey, location.focus.offset);
  if (!anchor || !focus) return null;
  const range = document.createRange();
  range.setStart(...anchor);
  range.setEnd(...anchor);
  // A backward location still covers the same text.
  if (range.comparePoint(...focus) < 0) range.setStart(...focus);
  else range.setEnd(...focus);
  return range;
}
