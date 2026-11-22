/** @vitest-environment jsdom */

import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test.each([8, 128])(
  'new %i-paragraph subtrees are complete before their first connected insertion',
  (size) => {
    const fixture = nativeSurface();
    let connectedDescendants = 0;
    const attachedText: string[] = [];
    const insert = Node.prototype.insertBefore;
    const writes = vi
      .spyOn(Node.prototype, 'insertBefore')
      .mockImplementation(function (this: Node, child, before) {
        if (this.isConnected) {
          if (this === fixture.root) attachedText.push(child.textContent ?? '');
          else connectedDescendants++;
        }
        return Reflect.apply(insert, this, [child, before]);
      });
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: Array.from({ length: size }, (_, i) => ({
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: `text${i}` }],
            })),
          },
        })
      );
      expect(fixture.root.innerHTML).toBe(
        Array.from(
          { length: size },
          (_, i) =>
            `<p dir="auto"><span data-lexical-text="true">text${i}</span></p>`
        ).join('')
      );
      expect(connectedDescendants).toBe(0);
      expect(attachedText).toEqual([fixture.root.textContent]);
    } finally {
      writes.mockRestore();
      fixture.close();
    }
  }
);

test('insertion replaces a managed break without moving either slot boundary', () => {
  const fixture = nativeSurface();
  const original = fixture.view.registry.get('paragraph');
  fixture.view.registry.replace('paragraph', {
    ...original,
    createDOM(node, context) {
      const dom = original.createDOM(node, context);
      dom.append(document.createElement('i'), document.createElement('b'));
      return dom;
    },
    getDOMSlot(_node, dom) {
      return { element: dom, after: dom.firstChild, before: dom.lastChild };
    },
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [] }],
        },
      })
    );
    const key = fixture.view.node(0)?.children[0];
    if (key === undefined) throw new Error('Missing paragraph');
    const dom = fixture.view.getElementByKey(key);
    if (!dom) throw new Error('Missing paragraph DOM');
    const prefix = dom.firstChild,
      suffix = dom.lastChild;
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key, type: 'element', offset: 0 },
      focus: { key, type: 'element', offset: 0 },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'x');
    expect(dom.firstChild).toBe(prefix);
    expect(dom.lastChild).toBe(suffix);
    expect(dom.innerHTML).toBe(
      '<i></i><span data-lexical-text="true">x</span><b></b>'
    );
  } finally {
    fixture.close();
  }
});

test('splitting a block keeps its reused text DOM and native caret', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'retained' }],
            },
          ],
        },
      })
    );
    const text = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!text) throw new Error('Missing native text');
    const dom = fixture.view.getElementByKey(text.key);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, type: 'text', offset: 0 },
      focus: { key: text.key, type: 'text', offset: 0 },
    });
    fixture.port.command(CommandCode.InsertParagraph);
    expect(fixture.view.getElementByKey(text.key)).toBe(dom);
    expect(fixture.root.children).toHaveLength(2);
    expect(fixture.root.textContent).toBe('retained');
    expect(fixture.view.selection().selection).toEqual({
      kind: 'range',
      anchor: { key: text.key, type: 'text', offset: 0 },
      focus: { key: text.key, type: 'text', offset: 0 },
    });
  } finally {
    fixture.close();
  }
});

test('a dynamic insertion boundary may retire during placeholder cleanup', () => {
  const fixture = nativeSurface();
  const original = fixture.view.registry.get('paragraph');
  fixture.view.registry.replace('paragraph', {
    ...original,
    getDOMSlot(_node, dom) {
      return {
        element: dom,
        get before() {
          return dom.querySelector('br');
        },
      };
    },
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [] }],
        },
      })
    );
    const key = fixture.view.node(0)?.children[0];
    if (key === undefined) throw new Error('Missing paragraph');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key, type: 'element', offset: 0 },
      focus: { key, type: 'element', offset: 0 },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, 'x');
    expect(fixture.root.innerHTML).toBe(
      '<p dir="auto"><span data-lexical-text="true">x</span></p>'
    );
  } finally {
    fixture.close();
  }
});

test('a new terminal line break precedes its managed paragraph break', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [] }],
        },
      })
    );
    const key = fixture.view.node(0)?.children[0];
    if (key === undefined) throw new Error('Missing paragraph');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key, type: 'element', offset: 0 },
      focus: { key, type: 'element', offset: 0 },
    });
    fixture.port.command(CommandCode.InsertLineBreak);
    const paragraph = fixture.view.node(key);
    const breakKey = paragraph?.children[0];
    if (breakKey === undefined) throw new Error('Missing line break');
    const dom = fixture.view.getElementByKey(key);
    expect(dom?.firstChild).toBe(fixture.view.getElementByKey(breakKey));
    expect(dom?.childNodes).toHaveLength(2);
  } finally {
    fixture.close();
  }
});

test('custom slot hooks keep connected layout observation during child assembly', () => {
  const fixture = nativeSurface();
  const original = fixture.view.registry.get('paragraph');
  const connected: boolean[] = [];
  fixture.view.registry.replace('paragraph', {
    ...original,
    getDOMSlot(_node, dom) {
      connected.push(dom.isConnected);
      return { element: dom };
    },
  });
  try {
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
                  type: 'text',
                  version: 1,
                  text: 'custom layout hook',
                },
              ],
            },
          ],
        },
      })
    );
    expect(connected.length).toBeGreaterThan(0);
    expect(connected.every(Boolean)).toBe(true);
    expect(fixture.root.textContent).toBe('custom layout hook');
  } finally {
    fixture.close();
  }
});
