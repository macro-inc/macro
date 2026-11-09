/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { TextFormatType } from 'lexical';
import type { DOMConversionMap, DOMConversionOutput } from './dom-types';
import { elementFormats } from './format';
import {
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
  TabNode,
  TextNode,
} from './index';

export type { DOMConversionMap } from './dom-types';

function isHTMLElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}
function isDOMTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}
function $isTextNode(node: LexicalNode): node is TextNode {
  return node instanceof TextNode;
}
function $createTextNode(text = ''): TextNode {
  return new TextNode(text);
}
function $createTabNode(): TabNode {
  return new TabNode();
}
function $createLineBreakNode(): LineBreakNode {
  return new LineBreakNode();
}
function convertSpanElement(domNode: HTMLElement): DOMConversionOutput {
  // domNode is a <span> since we matched it by nodeName
  const span = domNode;
  const style = span.style;

  return {
    forChild: applyTextFormatFromStyle(style),
    node: null,
  };
}

function convertBringAttentionToElement(
  domNode: HTMLElement
): DOMConversionOutput {
  // domNode is a <b> since we matched it by nodeName
  const b = domNode;
  // Google Docs wraps all copied HTML in a <b> with font-weight normal
  const hasNormalFontWeight = b.style.fontWeight === 'normal';

  return {
    forChild: applyTextFormatFromStyle(
      b.style,
      hasNormalFontWeight ? undefined : 'bold'
    ),
    node: null,
  };
}

const preParentCache = new WeakMap<Node, null | Node>();

function isNodePre(node: Node): boolean {
  if (!isHTMLElement(node)) {
    return false;
  } else if (node.nodeName === 'PRE') {
    return true;
  }
  const whiteSpace = node.style.whiteSpace;
  return typeof whiteSpace === 'string' && whiteSpace.startsWith('pre');
}

export function findParentPreDOMNode(node: Node) {
  let parent = node.parentNode;
  let cached = parent === null ? undefined : preParentCache.get(parent);
  const visited = [node];
  while (parent !== null && cached === undefined && !isNodePre(parent)) {
    visited.push(parent);
    parent = parent.parentNode;
    cached = parent === null ? undefined : preParentCache.get(parent);
  }
  const resultNode = cached === undefined ? parent : cached;
  for (let i = 0; i < visited.length; i++) {
    preParentCache.set(visited[i], resultNode);
  }
  return resultNode;
}

function $convertTextDOMNode(domNode: Node): DOMConversionOutput {
  if (!isDOMTextNode(domNode)) throw new Error('expected DOM text');
  const domNode_ = domNode;
  const parentDom = domNode.parentElement;
  if (parentDom === null)
    throw new Error('Expected parentElement of Text not to be null');
  let textContent = domNode_.textContent || '';
  // No collapse and preserve segment break for pre, pre-wrap and pre-line
  if (findParentPreDOMNode(domNode_) !== null) {
    const parts = textContent.split(/(\r?\n|\t)/);
    const nodes: Array<LexicalNode> = [];
    const length = parts.length;
    for (let i = 0; i < length; i++) {
      const part = parts[i];
      if (part === '\n' || part === '\r\n') {
        nodes.push($createLineBreakNode());
      } else if (part === '\t') {
        nodes.push($createTabNode());
      } else if (part !== '') {
        nodes.push($createTextNode(part));
      }
    }
    return { node: nodes };
  }
  textContent = textContent.replace(/\r/g, '').replace(/[ \t\n]+/g, ' ');
  if (textContent === '') {
    return { node: null };
  }
  if (textContent[0] === ' ') {
    // Traverse backward while in the same line. If content contains new line or tab -> potential
    // delete, other elements can borrow from this one. Deletion depends on whether it's also the
    // last space (see next condition: textContent[textContent.length - 1] === ' '))
    let previousText: null | Text = domNode_;
    let isStartOfLine = true;
    while (previousText !== null) {
      previousText = findTextInLine(previousText, false);
      if (previousText === null) break;
      const previousTextContent = previousText.textContent || '';
      if (previousTextContent.length > 0) {
        if (/[ \t\n]$/.test(previousTextContent)) {
          textContent = textContent.slice(1);
        }
        isStartOfLine = false;
        break;
      }
    }
    if (isStartOfLine) {
      textContent = textContent.slice(1);
    }
  }
  if (textContent[textContent.length - 1] === ' ') {
    // Traverse forward while in the same line, preserve if next inline will require a space
    let nextText: null | Text = domNode_;
    let isEndOfLine = true;
    while (nextText !== null) {
      nextText = findTextInLine(nextText, true);
      if (nextText === null) break;
      const nextTextContent = (nextText.textContent || '').replace(
        /^( |\t|\r?\n)+/,
        ''
      );
      if (nextTextContent.length > 0) {
        isEndOfLine = false;
        break;
      }
    }
    if (isEndOfLine) {
      textContent = textContent.slice(0, textContent.length - 1);
    }
  }
  if (textContent === '') {
    return { node: null };
  }
  return { node: $createTextNode(textContent) };
}

function findTextInLine(text: Text, forward: boolean): null | Text {
  let node: Node = text;

  while (true) {
    let sibling = forward ? node.nextSibling : node.previousSibling;
    while (sibling === null) {
      const parentElement = node.parentElement;
      if (parentElement === null) {
        return null;
      }
      node = parentElement;
      sibling = forward ? node.nextSibling : node.previousSibling;
    }
    node = sibling;
    if (isHTMLElement(node)) {
      const display = node.style.display;
      if (
        (display === '' && !isInlineDomNode(node)) ||
        (display !== '' && !display.startsWith('inline'))
      ) {
        return null;
      }
    }
    let descendant = forward ? node.firstChild : node.lastChild;
    while (descendant !== null) {
      node = descendant;
      descendant = forward ? node.firstChild : node.lastChild;
    }
    if (isDOMTextNode(node)) {
      return node;
    } else if (node.nodeName === 'BR') {
      return null;
    }
  }
}

const nodeNameToTextFormat: Record<string, TextFormatType> = {
  code: 'code',
  em: 'italic',
  i: 'italic',
  mark: 'highlight',
  s: 'strikethrough',
  strong: 'bold',
  sub: 'subscript',
  sup: 'superscript',
  u: 'underline',
};

function convertTextFormatElement(domNode: HTMLElement): DOMConversionOutput {
  const format = nodeNameToTextFormat[domNode.nodeName.toLowerCase()];
  if (format === undefined) {
    return { node: null };
  }
  return {
    forChild: applyTextFormatFromStyle(domNode.style, format),
    node: null,
  };
}

function applyTextFormatFromStyle(
  style: CSSStyleDeclaration,
  shouldApply?: TextFormatType
) {
  const fontWeight = style.fontWeight;
  const textDecoration = style.textDecoration.split(' ');
  // Google Docs uses span tags + font-weight for bold text
  const hasBoldFontWeight = fontWeight === '700' || fontWeight === 'bold';
  // Google Docs uses span tags + text-decoration: line-through for strikethrough text
  const hasLinethroughTextDecoration = textDecoration.includes('line-through');
  // Google Docs uses span tags + font-style for italic text
  const hasItalicFontStyle = style.fontStyle === 'italic';
  // Google Docs uses span tags + text-decoration: underline for underline text
  const hasUnderlineTextDecoration = textDecoration.includes('underline');
  // Google Docs uses span tags + vertical-align to specify subscript and superscript
  const verticalAlign = style.verticalAlign;

  return (lexicalNode: LexicalNode) => {
    if (!$isTextNode(lexicalNode)) {
      return lexicalNode;
    }
    if (hasBoldFontWeight && !lexicalNode.hasFormat('bold')) {
      lexicalNode.toggleFormat('bold');
    }
    if (
      hasLinethroughTextDecoration &&
      !lexicalNode.hasFormat('strikethrough')
    ) {
      lexicalNode.toggleFormat('strikethrough');
    }
    if (hasItalicFontStyle && !lexicalNode.hasFormat('italic')) {
      lexicalNode.toggleFormat('italic');
    }
    if (hasUnderlineTextDecoration && !lexicalNode.hasFormat('underline')) {
      lexicalNode.toggleFormat('underline');
    }
    if (verticalAlign === 'sub' && !lexicalNode.hasFormat('subscript')) {
      lexicalNode.toggleFormat('subscript');
    }
    if (verticalAlign === 'super' && !lexicalNode.hasFormat('superscript')) {
      lexicalNode.toggleFormat('superscript');
    }

    if (shouldApply && !lexicalNode.hasFormat(shouldApply)) {
      lexicalNode.toggleFormat(shouldApply);
    }

    return lexicalNode;
  };
}

const INLINE_TAG_RE =
  /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|mark|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var|#text)$/i;
const BLOCK_TAG_RE =
  /^(address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|noscript|ol|p|pre|section|table|td|tfoot|ul|video)$/i;
function isInlineDomNode(node: Node): boolean {
  return (
    (isHTMLElement(node) && node.style.display.startsWith('inline')) ||
    INLINE_TAG_RE.test(node.nodeName)
  );
}
function isBlockDomNode(node: Node): boolean {
  return (
    !(isHTMLElement(node) && node.style.display.startsWith('inline')) &&
    BLOCK_TAG_RE.test(node.nodeName)
  );
}

export function textImportDOM(): DOMConversionMap {
  const map: DOMConversionMap = {
    '#text': () => ({ conversion: $convertTextDOMNode, priority: 0 }),
    b: () => ({ conversion: convertBringAttentionToElement, priority: 0 }),
    span: () => ({ conversion: convertSpanElement, priority: 0 }),
  };
  for (const tag of [
    'code',
    'em',
    'i',
    'mark',
    's',
    'strong',
    'sub',
    'sup',
    'u',
  ]) {
    map[tag] = () => ({ conversion: convertTextFormatElement, priority: 0 });
  }
  return map;
}

export function paragraphImportDOM(): DOMConversionMap {
  return {
    p: () => ({
      priority: 0,
      conversion: (element) => {
        const node = new ParagraphNode();
        const cssAlign = element.style.textAlign;
        const align =
          Object.hasOwn(elementFormats, cssAlign) && cssAlign !== ''
            ? cssAlign
            : element.getAttribute('align') || '';
        for (const format of Object.keys(elementFormats)) {
          if (
            format === align &&
            (format === '' ||
              format === 'left' ||
              format === 'center' ||
              format === 'right' ||
              format === 'justify' ||
              format === 'start' ||
              format === 'end')
          )
            node.setFormat(format);
        }
        const indent = element.getAttribute('data-lexical-indent');
        const parsed =
          indent === null ? Number.NaN : Number.parseInt(indent, 10);
        node.setIndent(
          Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : Math.round(
                (Number.parseInt(element.style.paddingInlineStart, 10) || 0) /
                  40
              )
        );
        const direction = element.getAttribute('dir');
        if (direction === 'ltr' || direction === 'rtl')
          node.setDirection(direction);
        return { node };
      },
    }),
  };
}

function isWhitespaceDomTextNode(node: Node): boolean {
  return isDOMTextNode(node) && /^( |\t|\r?\n)+$/.test(node.textContent || '');
}

export function lineBreakImportDOM(): DOMConversionMap {
  return {
    br: (node) => {
      const parent = node.parentElement;
      if (parent !== null && isBlockDomNode(parent)) {
        const last = parent.lastChild;
        const atEnd =
          last === node ||
          (last !== null &&
            last.previousSibling === node &&
            isWhitespaceDomTextNode(last));
        if (atEnd) return null;
      }
      return { conversion: () => ({ node: new LineBreakNode() }), priority: 0 };
    },
  };
}
