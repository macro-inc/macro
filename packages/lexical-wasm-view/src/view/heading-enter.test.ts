// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('native heading Enter prevents the browser from inserting a second paragraph without a view route', () => {
  const { port, root, view, counters, close } = nativeSurface();
  try {
    port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'heading',
              tag: 'h1',
              children: [{ type: 'text', text: 'title' }],
            },
          ],
        },
      })
    );
    const text = [...view.mirror.values()].find((node) => node.type === 'text');
    if (!text) throw new Error('Missing heading text');
    const element = view.getElementByKey(text.key)?.firstChild;
    if (!element) throw new Error('Missing heading text DOM');
    root.focus();
    document.getSelection()?.setBaseAndExtent(element, 5, element, 5);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset: 5, type: 'text' },
      focus: { key: text.key, offset: 5, type: 'text' },
    });
    counters.admissions = 0;
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(counters.admissions).toBe(1);
    expect([...root.children].map((element) => element.tagName)).toEqual([
      'H1',
      'P',
    ]);
    expect(root.children[1].textContent).toBe('');
    expect(document.getSelection()?.anchorNode).toBe(root.children[1]);
    expect(document.getSelection()?.anchorOffset).toBe(0);
    const selection = view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range') throw new Error('Missing paragraph caret');
    expect(selection.anchor.key).toBe(view.node(0)?.children[1]);
    expect(selection.anchor.offset).toBe(0);
  } finally {
    close();
  }
});
