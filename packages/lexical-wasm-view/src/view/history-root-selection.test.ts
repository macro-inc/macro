/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
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

test.each(['no event', 'selectionchange', 'blur', 'new revision', 'dispose'])(
  'history settles the live root caret after %s',
  async (feedback) => {
    const fixture = nativeSurface();
    const button = fixture.root.ownerDocument.createElement('button');
    fixture.root.after(button);
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
      fixture.port.command(CommandCode.ClearHistory);
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
      const doc = fixture.root.ownerDocument;
      const dom = doc.getSelection();
      const leaf = doc
        .createTreeWalker(fixture.root, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!dom || !leaf) throw new Error('Missing code caret fixture');
      fixture.root.tabIndex = 0;
      fixture.root.focus();
      expect(doc.activeElement).toBe(fixture.root);
      dom.setBaseAndExtent(leaf, 3, leaf, 3);
      doc.dispatchEvent(new Event('selectionchange'));
      const admit = vi.spyOn(fixture.port, 'selectionFromView');
      fixture.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(fixture.root.querySelector('code')).toBeNull();
      expect(dom.anchorNode).toBe(fixture.root);
      expect(dom.anchorOffset).toBe(0);
      if (feedback === 'selectionchange')
        doc.dispatchEvent(new Event('selectionchange'));
      if (feedback === 'blur') button.focus();
      if (feedback === 'new revision') {
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
                    { type: 'text', version: 1, text: 'new revision' },
                  ],
                },
              ],
            },
          })
        );
      }
      if (feedback === 'dispose') fixture.view.dispose();
      await Promise.resolve();
      if (
        feedback === 'blur' ||
        feedback === 'new revision' ||
        feedback === 'dispose'
      ) {
        expect(admit).not.toHaveBeenCalled();
        if (feedback === 'blur') expect(doc.activeElement).toBe(button);
        return;
      }
      expect(admit).toHaveBeenCalledTimes(1);
      const paragraph = fixture.view.node(0)?.children[0];
      if (paragraph === undefined)
        throw new Error('Missing surviving paragraph');
      const point = { key: paragraph, offset: 0, type: 'element' };
      expect(fixture.view.selection().selection).toMatchObject({
        kind: 'range',
        anchor: point,
        focus: point,
      });
      expect(dom.anchorNode).toBe(fixture.root);
      expect(dom.anchorOffset).toBe(0);
      fixture.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(fixture.root.querySelector('code')?.textContent).toBe('abc');
      await Promise.resolve();
      const code = fixture.view.node(0)?.children[0];
      const text =
        code === undefined ? undefined : fixture.view.node(code)?.children[0];
      if (text === undefined) throw new Error('Missing redone text');
      const start = { key: text, offset: 0, type: 'text' };
      expect(fixture.view.selection().selection).toMatchObject({
        kind: 'range',
        anchor: start,
        focus: start,
      });
      expect(dom.anchorNode).toBe(fixture.root);
      expect(dom.anchorOffset).toBe(0);
    } finally {
      button.remove();
      fixture.close();
    }
  }
);
