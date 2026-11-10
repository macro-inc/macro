import { createEffect, onCleanup } from 'solid-js';
import type { EditorView } from '../src/view/editor-view';
import {
  type MacroDecorators,
  registerMacroViews,
} from '../src/view/node-views/macro';
import type { DecoratorProps, NodeViewRegistry } from '../src/view/registry';
import type { TypeRow } from '../src/view/types';
export const fixtureTypes: readonly TypeRow[] = [
  {
    index: 65534,
    name: 'image',
    kind: 'decorator',
    flags: {
      isInline: false,
      canInsertTextBefore: true,
      canInsertTextAfter: true,
      isKeyboardSelectable: true,
      isIsolated: false,
      isShadowRoot: false,
    },
  },
  { index: 65533, name: 'fixture-slot', kind: 'element' },
  { index: 65532, name: 'agent-session-mention', kind: 'decorator' },
];
export const decoratorStats = { mounts: 0, unmounts: 0 };
function Widget(props: DecoratorProps) {
  decoratorStats.mounts++;
  const element = document.createElement('span');
  element.dataset.widgetInstance = String(decoratorStats.mounts);
  createEffect(() => {
    const reservedHeight = props.node().props().reservedHeight;
    if (typeof reservedHeight === 'number') {
      element.style.display = 'block';
      element.style.height = `${reservedHeight}px`;
    }
    element.textContent = String(
      props.node().props().alt ??
        props.node().props().label ??
        props.node().type
    );
  });
  onCleanup(() => decoratorStats.unmounts++);
  return element;
}
export function registerFixtureViews(
  registry: NodeViewRegistry
): NodeViewRegistry {
  const components: MacroDecorators = {
    'account-manager-request': Widget,
    'agent-activity': Widget,
    'agent-context': Widget,
    'agent-session-mention': Widget,
    await: Widget,
    'booking-link-mention': Widget,
    'connect-app': Widget,
    'contact-mention': Widget,
    'system-notification': Widget,
    'database-query': Widget,
    'date-mention': Widget,
    'diff-insert': Widget,
    'document-card': Widget,
    'document-mention': Widget,
    equation: Widget,
    'group-mention': Widget,
    horizontalrule: Widget,
    'html-render': Widget,
    image: Widget,
    'magic-chip': Widget,
    paste: Widget,
    'pr-mention': Widget,
    'reply-target': Widget,
    snapshot: Widget,
    'tag-mention': Widget,
    'theme-mention': Widget,
    'unknown-mention': Widget,
    'user-mention': Widget,
    video: Widget,
    watermark: Widget,
  };
  registerMacroViews(registry, components);
  registry.register('fixture-slot', {
    createDOM(node, ctx) {
      const dom = ctx.document.createElement(
        node.props().tag === 'aside' ? 'aside' : 'section'
      );
      const before = ctx.document.createElement('button');
      before.contentEditable = 'false';
      before.textContent = 'before';
      const after = ctx.document.createElement('button');
      after.contentEditable = 'false';
      after.textContent = 'after';
      dom.append(before, after);
      return dom;
    },
    updateDOM(previous, next) {
      return previous.props().tag !== next.props().tag;
    },
    getDOMSlot(_, dom) {
      return { element: dom, after: dom.firstChild, before: dom.lastChild };
    },
  });
  return registry;
}
const imageKey = 1_000_000,
  containerKey = 1_000_001,
  textKey = 1_000_002;
export function renderFixture(view: EditorView) {
  const generation = () => view.mirror.keyGeneration ?? 0;
  const nativeChildren = () =>
    view.node(0)?.children.filter((key) => key < imageKey) ?? [];
  const imageProps = (alt: string) =>
    JSON.stringify({
      srcType: 'url',
      id: 'fixture-image',
      url: 'https://example.com/image.png',
      alt,
      width: 640,
      height: 480,
      constrainedWidth: 320,
      constrainedHeight: 240,
      reservedHeight: 240,
    });
  function createImage() {
    const strings = new TextEncoder().encode(imageProps('first'));
    const children = [...nativeChildren(), imageKey];
    view.apply(
      new Uint32Array([
        1,
        generation(),
        0,
        0xffffffff,
        2,
        4,
        imageKey,
        65534,
        0,
        strings.length,
        6,
        0,
        children.length,
        ...children,
      ]),
      strings
    );
  }
  function updateImage() {
    const strings = new TextEncoder().encode(imageProps('second'));
    view.apply(
      new Uint32Array([
        1,
        generation(),
        0,
        0xffffffff,
        1,
        10,
        imageKey,
        0,
        strings.length,
      ]),
      strings
    );
  }
  function removeImage() {
    const children = nativeChildren();
    view.apply(
      new Uint32Array([
        1,
        generation(),
        0,
        0xffffffff,
        2,
        1,
        imageKey,
        1,
        6,
        0,
        children.length,
        ...children,
      ]),
      new Uint8Array()
    );
  }
  function createSlot() {
    const textType = [...view.mirror.values()].find(
      (node) => node.kind === 'text'
    )?.typeIndex;
    if (textType === undefined) throw new Error('Missing text type');
    const props = new TextEncoder().encode('{"tag":"section"}'),
      text = new TextEncoder().encode('child');
    const strings = new Uint8Array(props.length + text.length);
    strings.set(props);
    strings.set(text, props.length);
    const children = [...nativeChildren(), containerKey];
    view.apply(
      new Uint32Array([
        1,
        generation(),
        0,
        0xffffffff,
        4,
        2,
        containerKey,
        65533,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        props.length,
        3,
        textKey,
        textType,
        0,
        0,
        0,
        props.length,
        text.length,
        0,
        0,
        0,
        0,
        6,
        0,
        children.length,
        ...children,
        6,
        containerKey,
        1,
        textKey,
      ]),
      strings
    );
  }
  function recreateSlot() {
    const strings = new TextEncoder().encode('{"tag":"aside"}');
    view.apply(
      new Uint32Array([
        1,
        generation(),
        0,
        0xffffffff,
        1,
        10,
        containerKey,
        0,
        strings.length,
      ]),
      strings
    );
  }
  function expandingDecorator(expanded: boolean) {
    const strings = new TextEncoder().encode(
      JSON.stringify({
        id: 'fixture-agent-session',
        label: expanded ? 'second' : 'first',
        expanded,
      })
    );
    const key = 1_000_003;
    if (!view.node(key)) {
      const children = [...nativeChildren(), key];
      view.apply(
        new Uint32Array([
          1,
          generation(),
          0,
          0xffffffff,
          2,
          4,
          key,
          65532,
          0,
          strings.length,
          6,
          0,
          children.length,
          ...children,
        ]),
        strings
      );
    } else
      view.apply(
        new Uint32Array([
          1,
          generation(),
          0,
          0xffffffff,
          1,
          10,
          key,
          0,
          strings.length,
        ]),
        strings
      );
  }
  return {
    expandingDecorator,
    createImage,
    updateImage,
    removeImage,
    createSlot,
    recreateSlot,
    stats: decoratorStats,
  };
}
