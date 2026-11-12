/** @vitest-environment jsdom */
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { mount, select, state } from './native-test-fixture';

function setup() {
  let dispose = () => {};
  const bridge = createRoot((stop) => {
    dispose = stop;
    return createNativeDocumentFormattingObserver({
      canEdit: () => true,
      alive: () => true,
    });
  });
  const runtime = mount([bridge.observer]);
  return {
    runtime,
    bridge,
    async cleanup() {
      dispose();
      await runtime.close();
      runtime.root.remove();
    },
  };
}

test('a collapsed caret and first Enter on 5000 blocks never request clipboard formats', async () => {
  const owned = setup();
  const { runtime } = owned;
  const formats = vi.spyOn(runtime.view.clipboard, 'formats');
  const nativeClipboard = vi.spyOn(runtime.executor.session, 'clipboardDom');
  try {
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: Array.from({ length: 5000 }, (_, i) => ({
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: `row-${i}` }],
          })),
        },
      })
    );
    const range = select(runtime, 'row-4999');
    if (range.kind !== 'range') throw new Error('Actual text range missing');
    const controller = owned.bridge.controller();
    if (!controller) throw new Error('Actual formatting controller missing');
    let visible = false;
    controller.menu.registerPopup({
      visible(value) {
        visible = value;
        return value;
      },
      selection() {},
    });
    formats.mockClear();
    nativeClipboard.mockClear();
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: range.focus,
      focus: range.focus,
    });
    expect(runtime.view.selection().selection).toEqual({
      kind: 'range',
      anchor: range.focus,
      focus: range.focus,
    });
    const enter = runtime.port.nativeEnter;
    if (!enter) throw new Error('Actual ordered native Enter missing');
    expect(enter.dispatch()).toBe(true);
    expect(runtime.root.querySelectorAll('p').length).toBe(5001);
    expect(visible).toBe(false);
    expect(formats.mock.calls.length).toBe(0);
    expect(nativeClipboard.mock.calls.length).toBe(0);
  } finally {
    formats.mockRestore();
    nativeClipboard.mockRestore();
    await owned.cleanup();
  }
}, 60000);

test('absent and node selections keep the text popup closed without clipboard export', async () => {
  const owned = setup();
  const { runtime } = owned;
  const formats = vi.spyOn(runtime.view.clipboard, 'formats');
  const nativeClipboard = vi.spyOn(runtime.executor.session, 'clipboardDom');
  try {
    runtime.port.setState(state('body'));
    const range = select(runtime, 'body');
    if (range.kind !== 'range') throw new Error('Actual text range missing');
    const controller = owned.bridge.controller();
    if (!controller) throw new Error('Actual controller missing');
    let visible = false;
    controller.menu.registerPopup({
      visible(value) {
        visible = value;
        return value;
      },
      selection() {},
    });
    formats.mockClear();
    nativeClipboard.mockClear();
    runtime.port.selectionFromView({ kind: 'none' });
    expect(visible).toBe(false);
    runtime.port.selectionFromView({ kind: 'node', keys: [range.anchor.key] });
    expect(visible).toBe(false);
    expect(formats.mock.calls.length).toBe(0);
    expect(nativeClipboard.mock.calls.length).toBe(0);
  } finally {
    formats.mockRestore();
    nativeClipboard.mockRestore();
    await owned.cleanup();
  }
});

for (const backward of [false, true]) {
  test(`expanded ${backward ? 'backward' : 'forward'} range keeps its exact text read and popup`, async () => {
    const owned = setup();
    const { runtime } = owned;
    const formats = vi.spyOn(runtime.view.clipboard, 'formats');
    const nativeClipboard = vi.spyOn(runtime.executor.session, 'clipboardDom');
    try {
      runtime.port.setState(state('left middle right'));
      const range = select(runtime, 'left middle right');
      if (range.kind !== 'range') throw new Error('Actual text range missing');
      const controller = owned.bridge.controller();
      if (!controller) throw new Error('Actual controller missing');
      let visible = false;
      controller.menu.registerPopup({
        visible(value) {
          visible = value;
          return value;
        },
        selection() {},
      });
      const text = document
        .createTreeWalker(runtime.root, NodeFilter.SHOW_TEXT)
        .nextNode();
      const dom = runtime.root.ownerDocument.getSelection();
      if (!text || !dom)
        throw new Error('Actual rendered text and DOM selection missing');
      dom.setBaseAndExtent(text, backward ? 11 : 5, text, backward ? 5 : 11);
      formats.mockClear();
      nativeClipboard.mockClear();
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { ...range.anchor, offset: backward ? 11 : 5 },
        focus: { ...range.focus, offset: backward ? 5 : 11 },
      });
      expect(formats.mock.calls.length).toBe(1);
      expect(formats.mock.results[0].value.plain).toBe('middle');
      expect(nativeClipboard.mock.calls.length).toBe(1);
      expect(visible).toBe(true);
    } finally {
      formats.mockRestore();
      nativeClipboard.mockRestore();
      await owned.cleanup();
    }
  });
}

test('the native table popup keeps its real cell facts without requesting clipboard text', async () => {
  const owned = setup();
  const { runtime } = owned;
  const formats = vi.spyOn(runtime.view.clipboard, 'formats');
  const nativeClipboard = vi.spyOn(runtime.executor.session, 'clipboardDom');
  try {
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: ['A', 'B'].map((text) => ({
                    type: 'tablecell',
                    version: 1,
                    colSpan: 1,
                    rowSpan: 1,
                    headerState: 0,
                    children: [
                      {
                        type: 'paragraph',
                        version: 1,
                        children: [{ type: 'text', version: 1, text }],
                      },
                    ],
                  })),
                },
              ],
            },
          ],
        },
      })
    );
    const table = [...runtime.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    const cells = [...runtime.view.mirror.values()].filter(
      (node) => node.type === 'tablecell'
    );
    if (!table || cells.length !== 2)
      throw new Error('Actual native table missing');
    const controller = owned.bridge.controller();
    if (!controller) throw new Error('Actual controller missing');
    let visible = false;
    controller.menu.registerPopup({
      visible(value) {
        visible = value;
        return value;
      },
      selection() {},
    });
    formats.mockClear();
    nativeClipboard.mockClear();
    runtime.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: cells[0].key,
      focusCell: cells[1].key,
    });
    expect(controller.host.tables?.canMerge()).toBe(true);
    expect(visible).toBe(true);
    expect(formats.mock.calls.length).toBe(0);
    expect(nativeClipboard.mock.calls.length).toBe(0);
  } finally {
    formats.mockRestore();
    nativeClipboard.mockRestore();
    await owned.cleanup();
  }
});
