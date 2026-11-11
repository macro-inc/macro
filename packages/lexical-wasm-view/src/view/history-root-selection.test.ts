/** @vitest-environment jsdom */
import { beforeAll, expect, test, vi } from 'vitest';
import { readSelectionFromChange } from './selection';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('actual root DOM selection resolves to the empty block, code start, and trailing paragraph', () => {
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
    const dom = fixture.root.ownerDocument.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    const paragraph = fixture.view.node(0)?.children[0];
    dom.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
    expect(readSelectionFromChange(fixture.view)).toEqual({
      kind: 'range',
      anchor: { key: paragraph, offset: 0, type: 'element' },
      focus: { key: paragraph, offset: 0, type: 'element' },
      dirty: false,
    });

    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'custom-code',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'abc' }],
            },
          ],
        },
      })
    );
    const code = fixture.view.node(0)?.children[0];
    if (code === undefined) throw new Error('Missing code block');
    const text = fixture.view.node(code)?.children[0];
    const trailing = fixture.view.node(0)?.children[1];
    if (text === undefined || trailing === undefined)
      throw new Error('Missing code text or trailing paragraph');
    expect(fixture.view.node(trailing)?.type).toBe('paragraph');
    dom.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
    expect(readSelectionFromChange(fixture.view)).toEqual({
      kind: 'range',
      anchor: { key: text, offset: 0, type: 'text' },
      focus: { key: text, offset: 0, type: 'text' },
      dirty: false,
    });
    expect(dom.anchorNode).toBe(fixture.root);
    const end = fixture.root.childNodes.length;
    dom.setBaseAndExtent(fixture.root, end, fixture.root, end);
    expect(readSelectionFromChange(fixture.view)).toEqual({
      kind: 'range',
      anchor: { key: trailing, offset: 0, type: 'element' },
      focus: { key: trailing, offset: 0, type: 'element' },
      dirty: false,
    });
  } finally {
    fixture.close();
  }
});

test('routed undo keeps the model point admitted from the root DOM boundary', () => {
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
    const doc = fixture.root.ownerDocument;
    const dom = doc.getSelection();
    const paragraph = fixture.view.node(0)?.children[0];
    if (!dom || paragraph === undefined) throw new Error('Missing fixture');
    fixture.root.focus();
    dom.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
    doc.dispatchEvent(new Event('selectionchange'));
    const admitted = fixture.view.selection().selection;
    const point = { key: paragraph, offset: 0, type: 'element' };
    expect(admitted).toMatchObject({
      kind: 'range',
      anchor: point,
      focus: point,
    });

    dom.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
    const keyDown = vi.spyOn(fixture.port, 'keyDown');
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(keyDown.mock.calls[0]?.[4]).toMatchObject({
      kind: 'range',
      anchor: point,
      focus: point,
    });
  } finally {
    fixture.close();
  }
});
