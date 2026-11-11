/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from pinned lexical v0.45.0.
 */
import { isHTMLElement } from '../../../lexical-wasm-view/src/compat/dom-utils';

export {
  getDOMOwnerDocument,
  getDOMSelection,
  getDOMSelectionFromTarget,
  isDOMNode,
  isDocumentFragment,
  isHTMLElement,
} from '../../../lexical-wasm-view/src/compat/dom-utils';
export type {
  KeyboardEventModifierMask,
  KeyboardEventModifiers,
} from '../../../lexical-wasm-view/src/compat/utils';
export {
  getDOMTextNode,
  isDOMDocumentNode,
  isDOMTextNode,
  isExactShortcutMatch,
  isModifierMatch,
} from '../../../lexical-wasm-view/src/compat/utils';

import type {
  NodeKey,
  isBlockDomNode as OriginalBlockPredicate,
  isInlineDomNode as OriginalInlinePredicate,
} from 'lexical';

type GuardedNode<Guard> = Guard extends (
  node: Node
) => node is Node & infer Target
  ? Node & Target
  : never;
type BlockDOM = GuardedNode<typeof OriginalBlockPredicate>;
type InlineDOM = GuardedNode<typeof OriginalInlinePredicate>;

/** Pinned data-only private DOM fields; this contains no editor or node graph. */
interface LexicalPrivateDOM {
  __lexicalTextContent?: string | undefined | null;
  __lexicalFirstTextKey?: NodeKey | null | undefined;
  __lexicalLineBreak?: HTMLBRElement | HTMLImageElement | undefined | null;
  __lexicalLastChildKind?:
    | 'line-break'
    | 'decorator'
    | 'empty'
    | null
    | undefined;
  __lexicalDir?: 'ltr' | 'rtl' | null | undefined;
  __lexicalUnmanaged?: boolean | undefined;
}

/**
 * @param x - The element being tested
 * @returns Returns true if x is an HTML anchor tag, false otherwise
 */
export function isHTMLAnchorElement(x: unknown): x is HTMLAnchorElement {
  return isHTMLElement(x) && x.tagName === 'A';
}

/**
 * @param x - The element being tested
 * @returns Returns true if x is an HTML `<tr>` element, false otherwise
 */
export function isHTMLTableRowElement(x: unknown): x is HTMLTableRowElement {
  return isHTMLElement(x) && x.tagName === 'TR';
}

/**
 * @param x - The element being tested
 * @returns Returns true if x is an HTML `<td>` or `<th>` element, false
 *   otherwise
 */
export function isHTMLTableCellElement(x: unknown): x is HTMLTableCellElement {
  return isHTMLElement(x) && (x.tagName === 'TD' || x.tagName === 'TH');
}

const INLINE_TAG_RE =
  /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|mark|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var|#text)$/i;

/**
 *
 * @param node - the Dom Node to check
 * @returns if the Dom Node is an inline node
 */
export function isInlineDomNode(node: Node): node is InlineDOM {
  return isHTMLElement(node) && node.style.display.startsWith('inline')
    ? true
    : INLINE_TAG_RE.test(node.nodeName);
}

const BLOCK_TAG_RE =
  /^(address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|noscript|ol|p|pre|section|table|td|tfoot|ul|video)$/i;

/**
 *
 * @param node - the Dom Node to check
 * @returns if the Dom Node is a block node
 */
export function isBlockDomNode(node: Node): node is BlockDOM {
  return isHTMLElement(node) && node.style.display.startsWith('inline')
    ? false
    : BLOCK_TAG_RE.test(node.nodeName);
}

export function setDOMUnmanaged(
  elementDom: HTMLElement & LexicalPrivateDOM
): void {
  elementDom.__lexicalUnmanaged = true;
}
export function isDOMUnmanaged(elementDom: Node & LexicalPrivateDOM): boolean {
  return elementDom.__lexicalUnmanaged === true;
}
export function stopLexicalPropagation(event: Event): void {
  const lexicalEvent: Event & { _lexicalHandled?: boolean } = event;
  lexicalEvent._lexicalHandled = true;
}
