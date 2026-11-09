/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { EditorThemeClasses } from 'lexical';
import { COMPOSITION_SUFFIX } from '../../../lexical-wasm-view/src/compat/constants';
import type { DOMSlot } from '../../../lexical-wasm-view/src/compat/dom-slot';
import { IS_FIREFOX } from '../../../lexical-wasm-view/src/compat/environment';
import { setDOMStyleFromCSS } from './dom-style';
import type { EditorConfig } from './editor-config';
import { textFormats } from './format';
import type { TextNode } from './index';
import { numberResult, stringResult } from './results';
import { nodeField } from './runtime';

export function classNames(
  value: string | readonly string[] | undefined
): string[] {
  return typeof value === 'string'
    ? value.split(/\s+/).filter(Boolean)
    : [...(value ?? [])];
}

function outerTag(format: number): string | null {
  if (format & textFormats.code) return 'code';
  if (format & textFormats.highlight) return 'mark';
  if (format & textFormats.subscript) return 'sub';
  if (format & textFormats.superscript) return 'sup';
  return null;
}

function innerTag(format: number): string {
  if (format & textFormats.bold) return 'strong';
  if (format & textFormats.italic) return 'em';
  return 'span';
}

function isDOMText(node: Node): node is Text {
  return node.nodeType === 3;
}

function setTheme(
  dom: HTMLElement,
  prev: number,
  next: number,
  theme: NonNullable<EditorThemeClasses['text']>
): void {
  dom.classList.add(...classNames(theme.base));
  const combined = classNames(theme.underlineStrikethrough);
  const wasCombined =
    (prev & textFormats.underline) !== 0 &&
    (prev & textFormats.strikethrough) !== 0;
  const isCombined =
    (next & textFormats.underline) !== 0 &&
    (next & textFormats.strikethrough) !== 0;
  if (combined.length > 0) {
    if (isCombined && !wasCombined) dom.classList.add(...combined);
    else if (!isCombined && wasCombined) dom.classList.remove(...combined);
  }
  for (const [type, flag] of Object.entries(textFormats)) {
    const names = classNames(theme[type]);
    if ((next & flag) !== 0) {
      if (
        combined.length > 0 &&
        isCombined &&
        (type === 'underline' || type === 'strikethrough')
      ) {
        if (prev & flag) dom.classList.remove(...names);
      } else if (
        (prev & flag) === 0 ||
        (wasCombined && type === 'underline') ||
        type === 'strikethrough'
      ) {
        dom.classList.add(...names);
      }
    } else if (prev & flag) dom.classList.remove(...names);
  }
}

function setText(
  dom: HTMLElement,
  text: string,
  composing: boolean,
  slotFor: (dom: HTMLElement) => DOMSlot<HTMLElement>
): void {
  const value = text + (composing ? COMPOSITION_SUFFIX : '');
  const slot = slotFor(dom);
  const child = slot.getFirstChild();
  if (child === null || child.nodeType !== 3) {
    slot.insertChild(document.createTextNode(value));
    return;
  }
  if (child.nodeValue === value) return;
  if ((composing || IS_FIREFOX) && isDOMText(child)) {
    const previous = child.nodeValue ?? '';
    let left = 0;
    let right = 0;
    while (
      left < previous.length &&
      left < value.length &&
      previous[left] === value[left]
    )
      left++;
    while (
      right + left < previous.length &&
      right + left < value.length &&
      previous[previous.length - right - 1] === value[value.length - right - 1]
    )
      right++;
    const remove = previous.length - left - right;
    if (remove !== 0) child.deleteData(left, remove);
    child.insertData(left, value.slice(left, value.length - right));
  } else child.nodeValue = value;
}

export function createTextDOM(
  node: TextNode,
  config: EditorConfig,
  composing: boolean,
  slotFor: (dom: HTMLElement) => DOMSlot<HTMLElement>
): HTMLElement {
  const format = numberResult(nodeField(node, '__format'));
  const outer = outerTag(format);
  const inner = innerTag(format);
  const dom = document.createElement(outer ?? inner);
  let content = dom;
  if (node.hasFormat('code')) dom.setAttribute('spellcheck', 'false');
  if (outer !== null) {
    content = document.createElement(inner);
    dom.appendChild(content);
  }
  setText(content, stringResult(nodeField(node, '__text')), composing, slotFor);
  if (config.theme.text !== undefined)
    setTheme(content, 0, format, config.theme.text);
  const style = stringResult(nodeField(node, '__style'));
  if (style !== '') setDOMStyleFromCSS(dom.style, style);
  return dom;
}

export function updateTextDOM(
  node: TextNode,
  prev: TextNode,
  dom: HTMLElement,
  config: EditorConfig,
  composing: boolean,
  slotFor: (dom: HTMLElement) => DOMSlot<HTMLElement>
): boolean {
  const previous = numberResult(nodeField(prev, '__format'));
  const next = numberResult(nodeField(node, '__format'));
  const prevOuter = outerTag(previous);
  const nextOuter = outerTag(next);
  const prevInner = innerTag(previous);
  const nextInner = innerTag(next);
  if ((prevOuter ?? prevInner) !== (nextOuter ?? nextInner)) return true;
  let content = dom;
  if (prevOuter === nextOuter && prevInner !== nextInner) {
    const child = dom.firstChild;
    if (!(child instanceof HTMLElement))
      throw new Error('updateDOM: prevInnerDOM is null or undefined');
    content = document.createElement(nextInner);
    setText(
      content,
      stringResult(nodeField(node, '__text')),
      composing,
      slotFor
    );
    if (config.theme.text !== undefined)
      setTheme(content, 0, next, config.theme.text);
    dom.replaceChild(content, child);
    return false;
  }
  if (nextOuter !== null && prevOuter !== null) {
    const child = dom.firstChild;
    if (!(child instanceof HTMLElement))
      throw new Error('updateDOM: innerDOM is null or undefined');
    content = child;
  }
  setText(content, stringResult(nodeField(node, '__text')), composing, slotFor);
  if (config.theme.text !== undefined && previous !== next)
    setTheme(content, previous, next, config.theme.text);
  const oldStyle = stringResult(nodeField(prev, '__style'));
  const style = stringResult(nodeField(node, '__style'));
  if (oldStyle !== style) setDOMStyleFromCSS(dom.style, style, oldStyle);
  return false;
}
