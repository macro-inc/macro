/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

// Fuzz D003: after Enter and Undo the browser caret is at the root end while
// the model keeps the paragraph start. Source keydown clones the model range.
test.each([
  { key: '#', code: 'Digit3', shiftKey: true },
  { key: '😀', code: '', shiftKey: false },
])(
  'an unrouted $key keydown keeps the admitted range over a root DOM caret',
  ({ key, code, shiftKey }) => {
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
      const paragraph = [...fixture.view.mirror.values()].find(
        (node) => node.type === 'paragraph'
      );
      if (!paragraph) throw new Error('Missing actual paragraph');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: paragraph.key, offset: 0, type: 'element' },
        focus: { key: paragraph.key, offset: 0, type: 'element' },
      });
      const admitted = fixture.view.selection().selection;
      const dom = fixture.root.ownerDocument.getSelection();
      if (!dom) throw new Error('Missing DOM selection');
      fixture.root.tabIndex = 0;
      fixture.root.focus();
      dom.setBaseAndExtent(fixture.root, 1, fixture.root, 1);
      fixture.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code,
          shiftKey,
          bubbles: true,
          cancelable: true,
        })
      );
      // Source $internalCreateSelection clones the previous range on keydown.
      expect(fixture.view.selection().selection).toEqual(admitted);
      expect(fixture.view.mirror.node(0)?.children).toEqual([paragraph.key]);
    } finally {
      fixture.close();
    }
  }
);
