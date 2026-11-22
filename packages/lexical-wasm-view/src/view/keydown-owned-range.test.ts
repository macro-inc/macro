/** @vitest-environment jsdom */
import { beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test.each([false, true])(
  'Enter uses the admitted selection when selectionchange delivered is %s',
  (admitted) => {
    const fixture = nativeSurface();
    try {
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
              { type: 'paragraph', version: 1, children: [] },
            ],
          },
        })
      );
      const doc = fixture.root.ownerDocument;
      const dom = doc.getSelection();
      const code = fixture.root.querySelector('code');
      const paragraph = fixture.root.querySelector('p');
      const leaf =
        code && doc.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode();
      if (!dom || !leaf || !paragraph) throw new Error('Missing fixture');
      fixture.root.tabIndex = 0;
      fixture.root.focus();
      dom.setBaseAndExtent(leaf, 0, leaf, 0);
      doc.dispatchEvent(new Event('selectionchange'));
      const codePoint = fixture.view.selection().selection;

      dom.setBaseAndExtent(paragraph, 0, paragraph, 0);
      if (admitted) doc.dispatchEvent(new Event('selectionchange'));
      const expected = fixture.view.selection().selection;
      if (admitted) expect(expected).not.toEqual(codePoint);
      else expect(expected).toEqual(codePoint);

      for (const key of ['Control', 'End']) {
        fixture.root.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
        expect(fixture.view.selection().selection).toEqual(expected);
      }
      fixture.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
      if (admitted) {
        expect(fixture.root.querySelectorAll(':scope > p')).toHaveLength(2);
        expect(code.querySelector('br')).toBeNull();
      } else {
        expect(fixture.root.querySelectorAll(':scope > p')).toHaveLength(1);
        expect(code.querySelector('br')).not.toBeNull();
      }
    } finally {
      fixture.close();
    }
  }
);

test('generic Enter does not preserve a published range for a foreign DOM caret', () => {
  const fixture = nativeSurface();
  const foreign = document.createElement('div');
  foreign.textContent = 'outside';
  fixture.root.after(foreign);
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
              children: [{ type: 'text', version: 1, text: 'inside' }],
            },
          ],
        },
      })
    );
    const doc = fixture.root.ownerDocument;
    const dom = doc.getSelection();
    const own = doc
      .createTreeWalker(fixture.root, NodeFilter.SHOW_TEXT)
      .nextNode();
    const other = foreign.firstChild;
    if (!dom || !own || !other) throw new Error('Missing fixture DOM');
    fixture.root.tabIndex = 0;
    fixture.root.focus();
    dom.setBaseAndExtent(own, 0, own, 0);
    doc.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection.kind).toBe('range');
    dom.setBaseAndExtent(other, 2, other, 2);
    const submitted = vi.spyOn(fixture.port, 'keyDown');
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(submitted.mock.calls[0]?.[4]).toEqual({ kind: 'none' });
  } finally {
    foreign.remove();
    fixture.close();
  }
});
