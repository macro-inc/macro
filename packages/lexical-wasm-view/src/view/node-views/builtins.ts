/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license found in the LICENSE file in the upstream root.
 * Retargeted from Lexical 0.45.0 nodes: 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */

import { textLeaf } from '../dom';
import {
  type NodeView,
  NodeViewRegistry,
  type RenderContext,
  themeClass,
} from '../registry';
import type { ViewNode } from '../types';

// LexicalLinkNode.sanitizeUrl/formatUrl at the pinned upstream revision.
function safeLink(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[/#.]/.test(url)) {
    if (url.includes('@')) url = `mailto:${url}`;
    else if (/^\+?[0-9\s()-]{5,}$/.test(url)) url = `tel:${url}`;
    else url = `https://${url}`;
  }
  try {
    const protocol = new URL(url).protocol;
    if (!['http:', 'https:', 'mailto:', 'sms:', 'tel:'].includes(protocol))
      return 'about:blank';
  } catch {
    return url;
  }
  return url;
}

function tag(node: ViewNode): string {
  const props = node.props();
  switch (node.type) {
    case 'root':
      return 'div';
    case 'paragraph':
      return 'p';
    case 'heading':
      return typeof props.tag === 'string' && /^h[1-6]$/.test(props.tag)
        ? props.tag
        : 'h1';
    case 'quote':
      return 'blockquote';
    case 'list':
    case 'task-list':
      return props.listType === 'number' ? 'ol' : 'ul';
    case 'listitem':
    case 'task-list-item':
      return 'li';
    case 'link':
    case 'autolink':
      return 'a';
    case 'code':
    case 'code-block':
    case 'custom-code':
      return 'code';
    case 'mark':
    case 'comment-mark':
      return 'mark';
    case 'table':
      return 'table';
    case 'tablerow':
      return 'tr';
    case 'tablecell':
      return typeof props.headerState === 'number' && props.headerState !== 0
        ? 'th'
        : 'td';
    default:
      throw new Error('No built-in element tag: ' + node.type);
  }
}
function elementProps(
  node: ViewNode,
  dom: HTMLElement,
  ctx: RenderContext
): void {
  const props = node.props(),
    fields = node.elementProps;
  const parent = node.parent === null ? null : ctx.view.node(node.parent);
  const automatic =
    parent &&
    (parent.kind === 'root' || ctx.view.flags(parent)?.isShadowRoot) &&
    !parent.elementProps?.direction;
  if (fields?.direction === 1) dom.dir = 'ltr';
  else if (fields?.direction === 2) dom.dir = 'rtl';
  else if (node.kind !== 'root' && automatic) dom.dir = 'auto';
  else dom.removeAttribute('dir');
  if (node.kind === 'root') {
    dom.style.userSelect = 'text';
    dom.style.whiteSpace = 'pre-wrap';
    dom.style.wordBreak = 'break-word';
  } else dom.style.cssText = fields?.style ?? '';
  const alignment =
    ['', 'left', 'center', 'right', 'justify', 'start', 'end'][
      fields?.format ?? 0
    ] ?? '';
  dom.style.textAlign = alignment;
  if (node.parent === 0) {
    dom.style.contentVisibility = 'auto';
    dom.style.containIntrinsicBlockSize = 'auto 24px';
  }
  if (fields?.indent) dom.style.paddingInlineStart = `${fields.indent * 40}px`;
  if (node.type === 'link' || node.type === 'autolink') {
    // The model stores the URL; the view only applies a safe DOM attribute.
    const url = typeof props.url === 'string' ? props.url : '';
    dom.setAttribute('href', safeLink(url));
    for (const name of ['target', 'rel', 'title']) {
      if (typeof props[name] === 'string') dom.setAttribute(name, props[name]);
      else dom.removeAttribute(name);
    }
  }
  if (node.type === 'list' || node.type === 'task-list') {
    dom.setAttribute('data-list-type', String(props.listType ?? 'bullet'));
    if (typeof props.start === 'number' && props.start !== 1)
      dom.setAttribute('start', String(props.start));
    else dom.removeAttribute('start');
  }
  if (node.type === 'listitem' || node.type === 'task-list-item') {
    if (typeof props.value === 'number')
      dom.setAttribute('value', String(props.value));
    if (typeof props.checked === 'boolean') {
      dom.setAttribute('role', 'checkbox');
      dom.setAttribute('aria-checked', String(props.checked));
    } else {
      dom.removeAttribute('role');
      dom.removeAttribute('aria-checked');
    }
  }
  if (node.type === 'tablerow' && typeof props.height === 'number')
    dom.style.height = `${props.height}px`;
  if (node.type === 'tablecell') {
    for (const name of ['colSpan', 'rowSpan']) {
      if (typeof props[name] === 'number')
        dom.setAttribute(name.toLowerCase(), String(props[name]));
      else dom.removeAttribute(name.toLowerCase());
    }
    if (typeof props.width === 'number') dom.style.width = `${props.width}px`;
    if (typeof props.backgroundColor === 'string')
      dom.style.backgroundColor = props.backgroundColor;
    if (props.verticalAlign === 'middle' || props.verticalAlign === 'bottom')
      dom.style.verticalAlign = props.verticalAlign;
  }
  if (
    node.type === 'code' ||
    node.type === 'code-block' ||
    node.type === 'custom-code'
  ) {
    dom.spellcheck = false;
    dom.style.whiteSpace = 'pre-wrap';
    if (typeof props.language === 'string')
      dom.setAttribute('data-highlight-language', props.language);
  }
}
function elementClasses(node: ViewNode, ctx: RenderContext): string {
  const props = node.props();
  if (node.type === 'heading')
    return themeClass(ctx.theme, 'heading', tag(node));
  if (node.type === 'list' || node.type === 'task-list') {
    const listTag = props.listType === 'number' ? 'ol' : 'ul';
    let depth = 0;
    for (
      let parent = node.parent === null ? null : ctx.view.node(node.parent);
      parent;
      parent = parent.parent === null ? null : ctx.view.node(parent.parent)
    ) {
      if (parent.type === 'list' || parent.type === 'task-list') depth++;
    }
    return [
      themeClass(ctx.theme, 'list', listTag),
      themeClass(ctx.theme, 'list', listTag + 'Depth', String(depth)),
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (node.type === 'listitem')
    return [
      themeClass(ctx.theme, 'list', 'listitem'),
      typeof props.checked === 'boolean'
        ? themeClass(
            ctx.theme,
            'list',
            props.checked ? 'listitemChecked' : 'listitemUnchecked'
          )
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  if (node.type === 'tablecell')
    return [
      themeClass(ctx.theme, 'tableCell'),
      props.headerState ? themeClass(ctx.theme, 'tableCellHeader') : '',
    ]
      .filter(Boolean)
      .join(' ');
  const name = node.type === 'tablerow' ? 'tableRow' : node.type;
  return themeClass(ctx.theme, name);
}
const element: NodeView = {
  createDOM(node, ctx) {
    const dom = ctx.document.createElement(tag(node));
    dom.className = elementClasses(node, ctx);
    elementProps(node, dom, ctx);
    return dom;
  },
  updateDOM(previous, next, dom, ctx) {
    if (tag(previous) !== tag(next)) return true;
    elementProps(next, dom, ctx);
    if (next.kind !== 'root') dom.className = elementClasses(next, ctx);
    return false;
  },
};
function textTag(node: ViewNode): string {
  const format = node.textProps?.format ?? 0;
  if (format & 16) return 'code';
  if (format & 128) return 'mark';
  if (format & 32) return 'sub';
  if (format & 64) return 'sup';
  return innerTextTag(node);
}
function innerTextTag(node: ViewNode): string {
  const format = node.textProps?.format ?? 0;
  if (format & 1) return 'strong';
  if (format & 2) return 'em';
  return 'span';
}
function textProperties(
  node: ViewNode,
  dom: HTMLElement,
  ctx: RenderContext
): void {
  const props = node.textProps;
  const format = props?.format ?? 0;
  dom.style.cssText = props?.style ?? '';
  const inner =
    dom.firstElementChild instanceof HTMLElement ? dom.firstElementChild : dom;
  const classes = [
    themeClass(ctx.theme, 'text', 'base') || themeClass(ctx.theme, 'text'),
  ];
  const combined =
    format & 4 && format & 8
      ? themeClass(ctx.theme, 'text', 'underlineStrikethrough')
      : '';
  if (combined) classes.push(combined);
  for (const [bit, name] of [
    [1, 'bold'],
    [2, 'italic'],
    [4, 'strikethrough'],
    [8, 'underline'],
    [16, 'code'],
    [32, 'subscript'],
    [64, 'superscript'],
    [128, 'highlight'],
    [256, 'lowercase'],
    [512, 'uppercase'],
    [1024, 'capitalize'],
  ] as const) {
    if (format & bit && !(combined && (bit === 4 || bit === 8)))
      classes.push(
        themeClass(ctx.theme, 'text', name) || themeClass(ctx.theme, name)
      );
  }
  if (node.type === 'code-highlight')
    classes.push(
      themeClass(
        ctx.theme,
        'codeHighlight',
        String(node.props().highlightType ?? '')
      )
    );
  if (format & 16) dom.spellcheck = false;
  if (node.type === 'tab') classes.push(themeClass(ctx.theme, 'tab'));
  inner.className = classes.filter(Boolean).join(' ');
  dom.setAttribute('data-lexical-text', 'true');
}
const text: NodeView = {
  createDOM(node, ctx) {
    const dom = ctx.document.createElement(textTag(node));
    const innerTag = innerTextTag(node);
    const inner =
      textTag(node) === innerTag ? dom : ctx.document.createElement(innerTag);
    if (inner !== dom) dom.appendChild(inner);
    inner.appendChild(ctx.document.createTextNode(node.text));
    textProperties(node, dom, ctx);
    return dom;
  },
  updateDOM(previous, next, dom, ctx) {
    if (
      textTag(previous) !== textTag(next) ||
      innerTextTag(previous) !== innerTextTag(next)
    )
      return true;
    if (
      previous.textProps !== next.textProps ||
      previous.propsJSON !== next.propsJSON
    )
      textProperties(next, dom, ctx);
    const child = textLeaf(dom);
    if (!child || child.nodeType !== 3)
      throw new Error('Missing DOM text node');
    if (child.nodeValue !== next.text) child.nodeValue = next.text;
    return false;
  },
};
export function createBuiltinRegistry(): NodeViewRegistry {
  const registry = new NodeViewRegistry();
  for (const name of [
    'root',
    'paragraph',
    'heading',
    'quote',
    'list',
    'listitem',
    'task-list-item',
    'link',
    'autolink',
    'code',
    'code-block',
    'mark',
    'comment-mark',
    'tablerow',
    'tablecell',
  ])
    registry.register(name, element);
  const updateColumns = (
    node: ViewNode,
    dom: HTMLElement,
    ctx: RenderContext
  ) => {
    const group = dom.querySelector(':scope > colgroup');
    if (!group) throw new Error('Missing table colgroup');
    const widths = node.props().colWidths;
    const values = Array.isArray(widths) ? widths : [];
    while (group.childNodes.length > values.length) group.lastChild?.remove();
    const columns = group.getElementsByTagName('col');
    values.forEach((width, index) => {
      const existing = columns.item(index);
      const col = existing ?? ctx.document.createElement('col');
      if (!existing) group.appendChild(col);
      col.style.width = typeof width === 'number' ? `${width}px` : '';
    });
  };
  registry.register('table', {
    createDOM(node, ctx) {
      const dom = element.createDOM(node, ctx);
      dom.appendChild(ctx.document.createElement('colgroup'));
      updateColumns(node, dom, ctx);
      return dom;
    },
    updateDOM(previous, next, dom, ctx) {
      const replace = element.updateDOM(previous, next, dom, ctx);
      updateColumns(next, dom, ctx);
      return replace;
    },
    getDOMSlot(_, dom) {
      return { element: dom, after: dom.querySelector(':scope > colgroup') };
    },
  });
  registry.register('task-list', {
    createDOM(node, ctx) {
      const dom = element.createDOM(node, ctx);
      if (node.props().listType === 'check') {
        const bar = ctx.document.createElement('div');
        bar.className = 'mdtl-bar-mount';
        bar.contentEditable = 'false';
        dom.insertBefore(bar, dom.firstChild);
      }
      return dom;
    },
    updateDOM(previous, next, dom, ctx) {
      if (previous.props().listType !== next.props().listType) return true;
      return element.updateDOM(previous, next, dom, ctx);
    },
    getDOMSlot(_, dom) {
      return {
        element: dom,
        after: dom.querySelector(':scope > .mdtl-bar-mount'),
      };
    },
  });
  for (const name of ['text', 'tab', 'code-highlight'])
    registry.register(name, text);
  registry.register('linebreak', {
    createDOM: (_, ctx) => ctx.document.createElement('br'),
    updateDOM: () => false,
  });
  return registry;
}
