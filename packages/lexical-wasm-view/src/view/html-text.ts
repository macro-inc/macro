/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalTextNode.ts whitespace/preformatted import,
 * LexicalUtils.ts inline/block tags; 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import type { JsonObject } from './types';

const inlineTags =
  /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|mark|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var|#text)$/i;
const blockTags =
  /^(address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|noscript|ol|p|pre|section|table|td|tfoot|ul|video)$/i;
export function isBlockDOM(
  node: Node,
  ElementType: typeof HTMLElement
): boolean {
  return node instanceof ElementType && node.style.display.startsWith('inline')
    ? false
    : blockTags.test(node.nodeName);
}
function findTextInLine(
  text: Node,
  forward: boolean,
  ElementType: typeof HTMLElement
): Node | null {
  let node = text;
  while (true) {
    let sibling = forward ? node.nextSibling : node.previousSibling;
    while (!sibling) {
      const parent = node.parentElement;
      if (!parent) return null;
      node = parent;
      sibling = forward ? node.nextSibling : node.previousSibling;
    }
    node = sibling;
    if (node instanceof ElementType) {
      const display = node.style.display;
      const inline =
        display.startsWith('inline') || inlineTags.test(node.nodeName);
      if ((!display && !inline) || (display && !display.startsWith('inline')))
        return null;
    }
    let descendant = forward ? node.firstChild : node.lastChild;
    while (descendant) {
      node = descendant;
      descendant = forward ? node.firstChild : node.lastChild;
    }
    if (node.nodeType === 3) return node;
    if (node.nodeName === 'BR') return null;
  }
}
export function textDraft(text: string, format: number): JsonObject {
  return {
    type: 'text',
    version: 1,
    text,
    format,
    detail: 0,
    mode: 'normal',
    style: '',
  };
}
export function convertText(
  node: Node,
  format: number,
  ElementType: typeof HTMLElement
): JsonObject[] {
  let text = node.textContent ?? '';
  let pre = false;
  for (let parent = node.parentElement; parent; parent = parent.parentElement)
    if (
      parent.nodeName === 'PRE' ||
      parent.style.whiteSpace.startsWith('pre')
    ) {
      pre = true;
      break;
    }
  if (pre)
    return text.split(/(\r?\n|\t)/).flatMap((part) => {
      if (part === '\n' || part === '\r\n')
        return [{ type: 'linebreak', version: 1 }];
      if (part === '\t')
        return [{ ...textDraft(part, format), type: 'tab', detail: 2 }];
      return part ? [textDraft(part, format)] : [];
    });
  text = text.replace(/\r/g, '').replace(/[ \t\n]+/g, ' ');
  if (text.startsWith(' ')) {
    let start = true;
    for (
      let previous = findTextInLine(node, false, ElementType);
      previous;
      previous = findTextInLine(previous, false, ElementType)
    ) {
      const value = previous.textContent ?? '';
      if (value.length) {
        if (/[ \t\n]$/.test(value)) text = text.slice(1);
        start = false;
        break;
      }
    }
    if (start) text = text.slice(1);
  }
  if (text.endsWith(' ')) {
    let end = true;
    for (
      let next = findTextInLine(node, true, ElementType);
      next;
      next = findTextInLine(next, true, ElementType)
    ) {
      if ((next.textContent ?? '').replace(/^( |\t|\r?\n)+/, '').length) {
        end = false;
        break;
      }
    }
    if (end) text = text.slice(0, -1);
  }
  return text ? [textDraft(text, format)] : [];
}
export function importLineBreak(
  node: HTMLElement,
  ElementType: typeof HTMLElement
): boolean {
  const parent = node.parentElement;
  if (!parent || !isBlockDOM(parent, ElementType)) return true;
  let last = parent.lastChild;
  if (last?.nodeType === 3 && /^( |\t|\r?\n)+$/.test(last.textContent ?? ''))
    last = last.previousSibling;
  return last !== node;
}
