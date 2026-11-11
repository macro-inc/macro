import type { Component } from 'solid-js';
import type {
  DecoratorProps,
  NodeViewRegistry,
  RenderContext,
} from '../registry';
import { themeClass } from '../registry';
import type { ViewNode } from '../types';

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
  if (attribute)
    dom.setAttribute(attribute[0], String(props[attribute[1]] ?? ''));
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
    const state: unknown = node.stateJSON ? JSON.parse(node.stateJSON) : null;
    const local: unknown =
      state !== null && typeof state === 'object'
        ? Reflect.get(state, 'local')
        : undefined;
    dom.classList.toggle('local', local !== false);
  }
  if (node.type === 'equation') dom.classList.add('md-editor-equation');
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
        if (type === 'html-render') {
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
        if (type === 'html-render') dom.style.display = 'block';
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

/** Install common element/text views once before application group decorators. */
export function registerMacroElementViews(
  registry: NodeViewRegistry
): NodeViewRegistry {
  for (const type of ['classed-block', 'completion', 'diff', 'diff-delete'])
    registry.register(type, {
      createDOM(node, ctx) {
        const dom = ctx.document.createElement(elementTag(node));
        elementProperties(node, dom);
        return dom;
      },
      updateDOM(previous, next, dom) {
        if (elementTag(previous) !== elementTag(next)) return true;
        elementProperties(next, dom);
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
  const code = registry.get('code');
  registry.register('custom-code', code);
  return registry;
}
