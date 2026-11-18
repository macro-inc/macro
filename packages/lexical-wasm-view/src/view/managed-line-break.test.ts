/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import { managedLineBreak } from './managed-line-break';
import { registerMacroDecoratorViews } from './node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('a captured slot retains its managed anchor, then resolves its removal after real insertion', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      'user-mention': () => document.createTextNode('mention'),
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'user-mention',
                  version: 1,
                  userId: 'literal-user',
                  email: 'user@example.com',
                  displayName: 'User',
                },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) =>
        node.type === 'paragraph' &&
        node.children.some(
          (key) => fixture.view.node(key)?.type === 'user-mention'
        )
    );
    if (!paragraph) throw new Error('Missing native paragraph');
    const slot = fixture.view.slot(paragraph.key);
    if (!slot) throw new Error('Missing native slot');
    const anchor = () => slot.before ?? null;
    const original = anchor();
    if (!(original instanceof HTMLElement))
      throw new Error('Missing managed DOM anchor');
    expect(original?.nodeName).toBe('BR');
    expect(slot.element.lastChild).toBe(original);
    expect(original?.attributes.length).toBe(0);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 0, type: 'element' },
      focus: { key: paragraph.key, offset: 0, type: 'element' },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'before');
    expect(anchor()).toBe(original);
    expect(slot.element.lastChild).toBe(original);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 2, type: 'element' },
      focus: { key: paragraph.key, offset: 2, type: 'element' },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'after');
    expect(anchor()).toBeNull();
    expect(managedLineBreak(slot.element)).toBeNull();
    expect(original?.parentNode).toBeNull();
    expect(slot.element.textContent).toBe('beforementionafter');
  } finally {
    fixture.close();
  }
});

test('managed anchors survive repeated reconciliation before a custom suffix and retire before text insertion', () => {
  const fixture = nativeSurface();
  try {
    const paragraphView = fixture.view.registry.get('paragraph');
    fixture.view.registry.replace('paragraph', {
      ...paragraphView,
      createDOM(node, context) {
        const element = paragraphView.createDOM(node, context);
        const suffix = context.document.createElement('span');
        suffix.dataset.suffix = 'true';
        suffix.textContent = 'suffix';
        element.appendChild(suffix);
        return element;
      },
      getDOMSlot(_node, element) {
        return { element, before: element.querySelector('[data-suffix]') };
      },
    });
    registerMacroDecoratorViews(fixture.view.registry, {
      'user-mention': () => document.createTextNode('mention'),
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'user-mention',
                  version: 1,
                  userId: 'literal-user',
                  email: 'user@example.com',
                  displayName: 'User',
                },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) =>
        node.type === 'paragraph' &&
        node.children.some(
          (key) => fixture.view.node(key)?.type === 'user-mention'
        )
    );
    if (!paragraph) throw new Error('Missing native paragraph');
    const slot = fixture.view.slot(paragraph.key);
    if (!slot) throw new Error('Missing custom slot');
    const original = slot.before;
    const suffix = slot.element.querySelector('[data-suffix]');
    expect(original?.nodeName).toBe('BR');
    expect(original?.nextSibling).toBe(suffix);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, type: 'element', offset: 0 },
      focus: { key: paragraph.key, type: 'element', offset: 0 },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'before');
    expect(slot.before).toBe(original);
    expect(original?.parentNode).toBe(slot.element);
    expect(original?.nextSibling).toBe(suffix);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, type: 'element', offset: 2 },
      focus: { key: paragraph.key, type: 'element', offset: 2 },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'after');
    expect(original?.parentNode).toBeNull();
    expect(slot.before).toBe(suffix);
    expect(slot.element.lastChild).toBe(suffix);
    expect(slot.element.textContent).toBe('beforementionaftersuffix');
  } finally {
    fixture.close();
  }
});

test('an Await DOM refresh preserves its mounted Source wrapper class', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      await: () => document.createTextNode('waiting'),
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'await',
                  version: 1,
                  awaitId: 'literal-await',
                  text: 'waiting',
                  inline: true,
                },
              ],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'await'
    );
    const element = node ? fixture.view.getElementByKey(node.key) : null;
    if (!node || !element) throw new Error('Missing actual Await DOM');
    expect(element.classList.contains('__decorator-mount-ref')).toBe(true);
    fixture.view.registry
      .get('await')
      .updateDOM(node, node, element, fixture.view.context);
    expect(element.classList.contains('__decorator-mount-ref')).toBe(true);
    expect(element.classList.contains('macro-await-node')).toBe(true);
    expect(element.firstElementChild?.nodeName).toBe('DIV');
  } finally {
    fixture.close();
  }
});
