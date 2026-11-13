/** @vitest-environment jsdom */

import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

// Source onSelectionChange: a collapsed caret takes its anchor text format (fuzz D015).
test('a collapsed selectionchange after Select All takes the anchor text format', () => {
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
              children: [
                { type: 'text', version: 1, text: 'b', format: 1 },
                { type: 'text', version: 1, text: ' ', format: 0 },
              ],
            },
          ],
        },
      })
    );
    const bold = [...fixture.view.mirror.values()].find((n) => n.text === 'b');
    const space = [...fixture.view.mirror.values()].find((n) => n.text === ' ');
    if (!bold || !space) throw new Error('Missing actual text nodes');
    const boldDOM = fixture.view.getElementByKey(bold.key)?.firstChild;
    const spaceDOM = fixture.view.getElementByKey(space.key)?.firstChild;
    if (!boldDOM || !spaceDOM) throw new Error('Missing actual DOM text');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
    fixture.view.root.focus();
    const dom = document.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    // Fuzz D015 step 1: the caret after the typed plain space.
    dom.setBaseAndExtent(spaceDOM, 1, spaceDOM, 1);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().format).toBe(0);
    // Step 2: the actual Select All route.
    fixture.view.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.view.selection().selection).toMatchObject({
      kind: 'range',
      anchor: { key: bold.key, offset: 0 },
      focus: { key: space.key, offset: 1 },
    });
    // Step 3, after Source's 200 ms collapsed-format mark expired: Shift+Home
    // leaves the browser caret at the bold text start.
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 1000);
    dom.setBaseAndExtent(boldDOM, 0, boldDOM, 0);
    document.dispatchEvent(new Event('selectionchange'));
    // Source revision [8, (b,0)-(b,0), 1, ""]: the anchor text format.
    expect(fixture.view.selection().selection).toMatchObject({
      kind: 'range',
      anchor: { key: bold.key, offset: 0, type: 'text' },
      focus: { key: bold.key, offset: 0, type: 'text' },
    });
    expect(fixture.view.selection().format).toBe(1);
  } finally {
    fixture.close();
  }
});
