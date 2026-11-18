import type { Component } from 'solid-js';
import type {
  DecoratorProps,
  NodeView,
  NodeViewRegistry,
  RenderContext,
} from '../registry';
import { themeClass } from '../registry';
import type { ViewNode } from '../types';
import { applyElementDirection } from './builtins';
import { setDOMStyleFromCSS } from './dom-style';

export const macroDecoratorTypes = [
  'account-manager-request',
  'agent-activity',
  'agent-context',
  'agent-session-mention',
  'await',
  'booking-link-mention',
  'connect-app',
  'contact-mention',
  'system-notification',
  'database-query',
  'date-mention',
  'diff-insert',
  'document-card',
  'document-mention',
  'equation',
  'group-mention',
  'horizontalrule',
  'html-render',
  'image',
  'magic-chip',
  'paste',
  'pr-mention',
  'reply-target',
  'snapshot',
  'tag-mention',
  'theme-mention',
  'unknown-mention',
  'user-mention',
  'video',
  'watermark',
] as const;
export type MacroDecoratorType = (typeof macroDecoratorTypes)[number];
export type MacroDecorators = Readonly<
  Record<MacroDecoratorType, Component<DecoratorProps>>
>;
const inlineDecorators = new Set<string>([
  'account-manager-request',
  'booking-link-mention',
  'connect-app',
  'contact-mention',
  'date-mention',
  'document-mention',
  'group-mention',
  'pr-mention',
  'snapshot',
  'tag-mention',
  'theme-mention',
  'unknown-mention',
  'user-mention',
  'watermark',
]);
function decoratorTag(node: ViewNode): string {
  if (node.type === 'agent-session-mention')
    return node.props().expanded ? 'div' : 'span';
  if (node.type === 'database-query')
    return node.props().displayMode === 'scalar' ? 'span' : 'div';
  if (node.type === 'equation' || node.type === 'await')
    return node.props().inline ? 'span' : 'div';
  return inlineDecorators.has(node.type) ? 'span' : 'div';
}
function decoratorProperties(node: ViewNode, dom: HTMLElement): void {
  const props = node.props();
  const attributes: Readonly<Record<string, readonly [string, string]>> = {
    'account-manager-request': ['data-account-manager-request', 'grantId'],
    'agent-activity': ['data-agent-activity', 'agentSessionId'],
    await: ['data-await-id', 'awaitId'],
    'connect-app': ['data-connect-app', 'appSlug'],
    'system-notification': ['data-system-notification', 'source'],
    'magic-chip': ['data-magic-chip', 'agentSessionId'],
    'reply-target': ['data-reply-target-node', 'targetMessageId'],
  };
  const attribute = attributes[node.type];
  // Source setAttribute(name, this.__field): a stored null or omitted field
  // becomes "null" or "undefined", not an empty attribute.
  if (attribute) dom.setAttribute(attribute[0], String(props[attribute[1]]));
  if (
    [
      'agent-session-mention',
      'booking-link-mention',
      'database-query',
      'document-card',
      'document-mention',
      'html-render',
      'pr-mention',
      'snapshot',
      'tag-mention',
      'theme-mention',
    ].includes(node.type)
  )
    dom.setAttribute(
      `data-${node.type}${['snapshot'].includes(node.type) ? '-node' : ''}`,
      'true'
    );
  if (node.type === 'paste') dom.setAttribute('data-paste-node', 'true');
  if (node.type === 'agent-context') dom.hidden = true;
  if (node.type === 'await') {
    dom.classList.add('macro-await-node');
    dom.classList.toggle('local', isLocal(node));
  }
  if (node.type === 'equation') dom.classList.add('md-editor-equation');
}
/** Source `$getLocal(node) ?? true`: only an explicit false marks a remote peer's node. */
function isLocal(node: ViewNode): boolean {
  const state: unknown = node.stateJSON ? JSON.parse(node.stateJSON) : null;
  return (
    state === null ||
    typeof state !== 'object' ||
    Reflect.get(state, 'local') !== false
  );
}
function elementTag(node: ViewNode): string {
  const tag = node.props().tag;
  if (node.type !== 'classed-block')
    return node.type === 'comment-mark' ? 'mark' : 'div';
  if (
    typeof tag !== 'string' ||
    !['div', 'p', 'span', 'blockquote'].includes(tag)
  )
    throw new Error('Invalid classed-block tag');
  return tag;
}
function elementProperties(node: ViewNode, dom: HTMLElement): void {
  const props = node.props();
  if (node.type === 'classed-block') {
    dom.setAttribute('data-classed-block', 'true');
    dom.className = Array.isArray(props.classes)
      ? props.classes.filter((value) => typeof value === 'string').join(' ')
      : '';
    const attributes = props.attributes;
    if (
      attributes &&
      typeof attributes === 'object' &&
      !Array.isArray(attributes)
    )
      for (const [key, value] of Object.entries(attributes))
        if (typeof value === 'string') dom.setAttribute(key, value);
  } else if (node.type === 'diff') {
    dom.className = 'md-diff';
    dom.setAttribute('data-diff-user-id', String(props.userId ?? ''));
    dom.setAttribute('data-diff-label', String(props.label ?? ''));
  } else if (node.type === 'diff-delete') dom.className = 'md-diff-delete';
  else if (node.type === 'completion')
    dom.className = props.isTransparent ? 'opacity-50' : 'opacity-100';
  else if (node.type === 'comment-mark') {
    dom.classList.add('comment');
    dom.classList.toggle('draft', Boolean(props.isDraft));
    dom.classList.toggle('local', isLocal(node));
    if (props.threadId) dom.dataset.threadId = String(props.threadId);
    else delete dom.dataset.threadId;
  }
}
/** Host components keep application dependencies outside the portable package. */
export function registerMacroViews(
  registry: NodeViewRegistry,
  decorators: MacroDecorators
): NodeViewRegistry {
  for (const type of macroDecoratorTypes) {
    if (!decorators[type])
      throw new Error('Missing Macro decorator component: ' + type);
  }
  registerMacroDecoratorViews(registry, decorators);
  return registerMacroElementViews(registry);
}

/** Register the concrete decorators owned by one application plugin group. */
export function registerMacroDecoratorViews(
  registry: NodeViewRegistry,
  decorators: Partial<MacroDecorators>
): NodeViewRegistry {
  for (const type of macroDecoratorTypes) {
    const component = decorators[type];
    if (!component) continue;
    registry.register(type, {
      decorator: component,
      createDecoratorHost(mount, context) {
        if (
          type === 'html-render' ||
          type === 'document-card' ||
          type === 'paste'
        ) {
          const selection = context.document.defaultView?.getSelection();
          if (selection) {
            selection.anchorNode;
            selection.focusNode;
          }
        }
        if (type === 'html-render') mount.style.display = 'block';
        mount.classList.add('__decorator-mount-ref');
        return context.document.createElement('div');
      },
      flags: (node) => ({
        isInline:
          type === 'agent-session-mention'
            ? !node.props().expanded
            : type === 'database-query'
              ? node.props().displayMode === 'scalar'
              : Boolean(node.props().inline),
        canInsertTextBefore: true,
        canInsertTextAfter: true,
        isKeyboardSelectable: type !== 'await',
        isIsolated: false,
        isShadowRoot: false,
      }),
      createDOM(node, ctx) {
        const dom = ctx.document.createElement(decoratorTag(node));
        if (
          type === 'html-render' ||
          type === 'document-card' ||
          type === 'paste'
        )
          dom.style.display = 'block';
        decoratorProperties(node, dom);
        return dom;
      },
      updateDOM(previous, next, dom) {
        if (decoratorTag(previous) !== decoratorTag(next)) return true;
        decoratorProperties(next, dom);
        return false;
      },
    });
  }
  return registry;
}

function stringProp(node: ViewNode, name: string): string | undefined {
  const value = node.props()[name];
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Source CodeNode.createDOM/updateDOM with CustomCodeNode's class reset and SVG
 * preview mode. Syntax-highlight support is highlighter state, so the
 * data-highlight-language attribute is left to the code highlighter.
 */
function customCodeView(svgPreview: boolean): NodeView {
  const preview = (node: ViewNode) =>
    svgPreview && node.props().previewEnabled === true;
  return {
    createDOM(node, ctx) {
      const dom = ctx.document.createElement('code');
      dom.className = themeClass(ctx.theme, 'code');
      dom.setAttribute('spellcheck', 'false');
      const language = stringProp(node, 'language');
      if (language) dom.setAttribute('data-language', language);
      const theme = stringProp(node, 'theme');
      if (theme) dom.setAttribute('data-theme', theme);
      const style = node.elementProps?.style ?? '';
      if (style) setDOMStyleFromCSS(dom.style, style);
      if (preview(node)) {
        dom.classList.toggle('preview-mode', true);
        // Source assigns contentEditable; the reflected attribute is the same.
        dom.setAttribute('contenteditable', 'false');
      }
      applyElementDirection(node, dom, ctx);
      return dom;
    },
    updateDOM(previous, next, dom, ctx) {
      const language = stringProp(next, 'language');
      const previousLanguage = stringProp(previous, 'language');
      if (language) {
        if (language !== previousLanguage)
          dom.setAttribute('data-language', language);
      } else if (previousLanguage) dom.removeAttribute('data-language');
      const theme = stringProp(next, 'theme');
      const previousTheme = stringProp(previous, 'theme');
      if (theme) {
        if (theme !== previousTheme) dom.setAttribute('data-theme', theme);
      } else if (previousTheme) dom.removeAttribute('data-theme');
      const style = next.elementProps?.style ?? '';
      const previousStyle = previous.elementProps?.style ?? '';
      if (style !== previousStyle)
        setDOMStyleFromCSS(dom.style, style, previousStyle);
      if (preview(previous) !== preview(next)) {
        dom.classList.toggle('preview-mode', preview(next));
        dom.setAttribute('contenteditable', preview(next) ? 'false' : 'true');
      }
      applyElementDirection(next, dom, ctx);
      return false;
    },
  };
}

/** Install common element/text views once before application group decorators. */
export function registerMacroElementViews(
  registry: NodeViewRegistry,
  /** Source ENABLE_SVG_PREVIEW; its default is enabled. */
  options: { svgPreview: boolean } = { svgPreview: true }
): NodeViewRegistry {
  for (const type of ['classed-block', 'completion', 'diff', 'diff-delete'])
    registry.register(type, {
      createDOM(node, ctx) {
        const dom = ctx.document.createElement(elementTag(node));
        elementProperties(node, dom);
        applyElementDirection(node, dom, ctx);
        return dom;
      },
      updateDOM(previous, next, dom, ctx) {
        if (elementTag(previous) !== elementTag(next)) return true;
        elementProperties(next, dom);
        applyElementDirection(next, dom, ctx);
        return false;
      },
    });
  for (const type of [
    'diff-text',
    'inline-search',
    'search-match',
    'unlinked-text',
  ]) {
    const base = registry.get('text');
    const properties = (
      node: ViewNode,
      dom: HTMLElement,
      ctx: RenderContext
    ) => {
      if (type === 'diff-text') {
        dom.classList.add(`diff-${String(node.props().diffStatus ?? '')}`);
        dom.dataset.diffStatus = String(node.props().diffStatus ?? '');
        if (typeof node.props().author === 'string')
          dom.setAttribute('data-diff-author', String(node.props().author));
        else dom.removeAttribute('data-diff-author');
      } else if (type === 'inline-search')
        dom.className = themeClass(ctx.theme, 'inline-search');
      else if (type === 'search-match') {
        const classes = themeClass(ctx.theme, 'searchMatch')
          .split(/\s+/)
          .filter(Boolean);
        dom.classList.add(...classes);
      }
    };
    registry.register(type, {
      createDOM(node, ctx) {
        const dom = base.createDOM(node, ctx);
        properties(node, dom, ctx);
        return dom;
      },
      updateDOM(previous, next, dom, ctx) {
        if (type === 'diff-text')
          dom.classList.remove(
            `diff-${String(previous.props().diffStatus ?? '')}`
          );
        const replace = base.updateDOM(previous, next, dom, ctx);
        properties(next, dom, ctx);
        return replace;
      },
    });
  }
  const mark = registry.get('mark');
  registry.replace('comment-mark', {
    createDOM(node, ctx) {
      const dom = mark.createDOM(node, ctx);
      elementProperties(node, dom);
      return dom;
    },
    updateDOM(previous, next, dom, ctx) {
      const replace = mark.updateDOM(previous, next, dom, ctx);
      elementProperties(next, dom);
      return replace;
    },
  });
  // Macro editors register Source tables with hasHorizontalScroll, so
  // TableNode.createDOM wraps each table in theme.tableScrollableWrapper
  // (inline overflow-x: auto without that class); the table stays the slot.
  const table = registry.get('table');
  const innerTable = (dom: HTMLElement) => {
    const inner = dom.querySelector(':scope > table');
    if (!(inner instanceof HTMLElement))
      throw new Error('Missing scrollable table element');
    return inner;
  };
  // Source updateTableWrapper: frozen counts toggle a wrapper class and a
  // table attribute, applied only when the count changes from the previous node.
  const frozen = (
    previous: ViewNode | null,
    next: ViewNode,
    wrapper: HTMLElement,
    inner: HTMLElement,
    ctx: RenderContext
  ) => {
    for (const [prop, themeKey, attribute] of [
      ['frozenColumnCount', 'tableFrozenColumn', 'data-lexical-frozen-column'],
      ['frozenRowCount', 'tableFrozenRow', 'data-lexical-frozen-row'],
    ] as const) {
      const count = (node: ViewNode | null) => {
        const value = node?.props()[prop];
        return typeof value === 'number' ? value : 0;
      };
      if (count(next) === count(previous)) continue;
      const classes = themeClass(ctx.theme, themeKey)
        .split(' ')
        .filter(Boolean);
      if (count(next) > 0) {
        wrapper.classList.add(...classes);
        inner.setAttribute(attribute, 'true');
      } else {
        wrapper.classList.remove(...classes);
        inner.removeAttribute(attribute);
      }
    }
  };
  // The reconciler applies an element's direction, indent and format to its
  // outer DOM, the wrapper; TableNode alignTableElement toggles the
  // tableAlignment classes on the table. The builtin view wrote the element
  // layout onto the table, so it moves to the wrapper here.
  const ALIGNMENTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
  const layout = (
    node: ViewNode,
    wrapper: HTMLElement,
    inner: HTMLElement,
    ctx: RenderContext
  ) => {
    const fields = node.elementProps;
    const alignment = ALIGNMENTS[fields?.format ?? 0] ?? '';
    inner.removeAttribute('dir');
    inner.style.textAlign = '';
    inner.style.paddingInlineStart = '';
    if (inner.getAttribute('style') === '') inner.removeAttribute('style');
    applyElementDirection(node, wrapper, ctx);
    if (alignment || wrapper.style.textAlign)
      wrapper.style.textAlign = alignment;
    if (fields?.indent || wrapper.style.paddingInlineStart)
      wrapper.style.paddingInlineStart = fields?.indent
        ? `${fields.indent * 40}px`
        : '';
    if (wrapper.getAttribute('style') === '') wrapper.removeAttribute('style');
    for (const format of ['center', 'right'] as const) {
      const classes = themeClass(ctx.theme, 'tableAlignment', format)
        .split(' ')
        .filter(Boolean);
      if (format === alignment) inner.classList.add(...classes);
      else inner.classList.remove(...classes);
    }
    if (inner.getAttribute('class') === '') inner.removeAttribute('class');
  };
  registry.replace('table', {
    createDOM(node, ctx) {
      const wrapper = ctx.document.createElement('div');
      const classes = themeClass(ctx.theme, 'tableScrollableWrapper');
      if (classes) wrapper.className = classes;
      else wrapper.style.overflowX = 'auto';
      const inner = table.createDOM(node, ctx);
      wrapper.appendChild(inner);
      frozen(null, node, wrapper, inner, ctx);
      layout(node, wrapper, inner, ctx);
      return wrapper;
    },
    updateDOM(previous, next, dom, ctx) {
      const inner = innerTable(dom);
      frozen(previous, next, dom, inner, ctx);
      const replace = table.updateDOM(previous, next, inner, ctx);
      layout(next, dom, inner, ctx);
      return replace;
    },
    getDOMSlot(node, dom) {
      const inner = innerTable(dom);
      return table.getDOMSlot
        ? table.getDOMSlot(node, inner)
        : { element: inner, after: null };
    },
  });
  registry.register('custom-code', customCodeView(options.svgPreview));
  return registry;
}
