/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { transfer } from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { readNativeSelectionText } from './native-selection';
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
      expect(formats.mock.calls.length).toBe(0);
      expect(nativeClipboard.mock.calls.length).toBe(0);
      expect(readNativeSelectionText(runtime.view)).toBe('middle');
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

test('ordinary and select-all publications never export clipboard formats', async () => {
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
          children: Array.from({ length: 64 }, (_, i) => ({
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: `row-${i}` }],
          })),
        },
      })
    );
    expect(formats).not.toHaveBeenCalled();
    expect(nativeClipboard).not.toHaveBeenCalled();
    expect(runtime.port.command(CommandCode.SelectAll)).toBe(true);
    const selection = runtime.view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range')
      throw new Error('Actual select-all range missing');
    expect(selection.anchor.key).not.toBe(selection.focus.key);
    expect(formats).not.toHaveBeenCalled();
    expect(nativeClipboard).not.toHaveBeenCalled();
  } finally {
    formats.mockRestore();
    nativeClipboard.mockRestore();
    await owned.cleanup();
  }
});

test('copy cut dragstart export on demand while paste publication stays plain-only', async () => {
  const owned = setup(),
    { runtime } = owned;
  const nativeClipboard = vi.spyOn(runtime.executor.session, 'clipboardDom');
  try {
    runtime.port.setState(state('left middle right'));
    const range = select(runtime, 'left middle right');
    if (range.kind !== 'range') throw new Error('Actual range missing');
    const text = document
      .createTreeWalker(runtime.root, NodeFilter.SHOW_TEXT)
      .nextNode();
    const dom = document.getSelection();
    if (!text || !dom) throw new Error('Actual DOM text/selection missing');
    dom.setBaseAndExtent(text, 5, text, 11);
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { ...range.anchor, offset: 5 },
      focus: { ...range.focus, offset: 11 },
    });
    expect(nativeClipboard).not.toHaveBeenCalled();
    const copied = transfer('');
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: copied });
    runtime.root.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(nativeClipboard).toHaveBeenCalledTimes(1);
    expect(copied.getData('text/plain')).toBe('middle');
    expect(copied.getData('text/html')).toContain('middle');
    expect(
      JSON.parse(copied.getData('application/x-lexical-editor')).nodes.length
    ).toBeGreaterThan(0);
    const cutData = transfer('');
    const cut = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(cut, 'clipboardData', { value: cutData });
    runtime.root.dispatchEvent(cut);
    expect(cut.defaultPrevented).toBe(true);
    expect(nativeClipboard).toHaveBeenCalledTimes(2);
    expect(cutData.getData('text/plain')).toBe('middle');
    expect(runtime.root.textContent).toBe('left  right');
    expect(
      await runtime.view.clipboard.paste(
        copied,
        runtime.view.selection().selection
      )
    ).toBe(true);
    expect(runtime.root.textContent).toBe('left middle right');
    expect(nativeClipboard).toHaveBeenCalledTimes(2);
    const paragraph = runtime.root.querySelector('p');
    if (!paragraph) throw new Error('Actual paragraph missing');
    paragraph.setAttribute('data-lexical-block-handle', '');
    const data = transfer('');
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(drag, 'dataTransfer', { value: data });
    paragraph.dispatchEvent(drag);
    expect(nativeClipboard).toHaveBeenCalledTimes(3);
    expect(nativeClipboard.mock.calls[2][0]).toBe(2);
    expect(data.getData('text/plain')).toBe('left middle right');
    expect(data.getData('text/html')).toContain('left');
    expect(
      JSON.parse(data.getData('application/x-lexical-editor')).nodes.length
    ).toBeGreaterThan(0);
    paragraph.dispatchEvent(new Event('dragend', { bubbles: true }));
  } finally {
    nativeClipboard.mockRestore();
    await owned.cleanup();
  }
});
