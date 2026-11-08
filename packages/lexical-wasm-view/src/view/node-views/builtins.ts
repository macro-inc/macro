/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license found in the LICENSE file in the upstream root.
 * Retargeted from Lexical 0.45.0 nodes: 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import {
  NodeViewRegistry,
  themeClass,
  type NodeView,
  type RenderContext,
} from '../registry';
import type { ViewNode } from '../types';

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
function elementProps(node: ViewNode, dom: HTMLElement): void {
  const props = node.props(),
    fields = node.elementProps;
  dom.dir =
    fields?.direction === 1 ? 'ltr' : fields?.direction === 2 ? 'rtl' : '';
  dom.style.cssText = fields?.style ?? '';
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
    dom.setAttribute(
      'href',
      /^\s*(javascript|vbscript|data):/i.test(url) ? 'about:blank' : url
    );
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
    elementProps(node, dom);
    return dom;
  },
  updateDOM(previous, next, dom, ctx) {
    if (tag(previous) !== tag(next)) return true;
    elementProps(next, dom);
    dom.className = elementClasses(next, ctx);
    return false;
  },
};
function textTag(node: ViewNode): string {
  const format = node.textProps?.format ?? 0;
  if (format & 16) return 'code';
  if (format & 32) return 'sub';
  if (format & 64) return 'sup';
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
  dom.style.fontWeight = format & 1 ? 'bold' : '';
  dom.style.fontStyle = format & 2 ? 'italic' : '';
  dom.style.textDecoration = [
    format & 4 ? 'line-through' : '',
    format & 8 ? 'underline' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const classes = [themeClass(ctx.theme, 'text')];
  for (const [bit, name] of [
    [1, 'bold'],
    [2, 'italic'],
    [4, 'strikethrough'],
    [8, 'underline'],
    [16, 'code'],
  ] as const) {
    if (format & bit)
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
  dom.className = classes.filter(Boolean).join(' ');
  dom.setAttribute('data-lexical-text', 'true');
}
const text: NodeView = {
  createDOM(node, ctx) {
    const dom = ctx.document.createElement(textTag(node));
    textProperties(node, dom, ctx);
    dom.appendChild(ctx.document.createTextNode(node.text));
    return dom;
  },
  updateDOM(previous, next, dom, ctx) {
    if (textTag(previous) !== textTag(next)) return true;
    if (
      previous.textProps !== next.textProps ||
      previous.propsJSON !== next.propsJSON
    )
      textProperties(next, dom, ctx);
    const child = dom.firstChild;
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
