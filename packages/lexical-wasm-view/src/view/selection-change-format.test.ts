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

// Source onSelectionChange runs its format rule even when the caret did not move.
test('a same-caret selectionchange after the mark expires restores the anchor text format', () => {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'Linux x86_64',
  });
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
              children: [{ type: 'text', version: 1, text: 'ab' }],
            },
          ],
        },
      })
    );
    const text = [...fixture.view.mirror.values()].find((n) => n.text === 'ab');
    const textDOM = text && fixture.view.getElementByKey(text.key)?.firstChild;
    if (!text || !textDOM) throw new Error('Missing actual text');
    fixture.view.root.focus();
    const dom = document.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    dom.setBaseAndExtent(textDOM, 1, textDOM, 1);
    document.dispatchEvent(new Event('selectionchange'));
    fixture.view.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        code: 'KeyB',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.view.selection().format).toBe(1);
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 1000);
    // A click on the same caret.
    dom.setBaseAndExtent(textDOM, 1, textDOM, 1);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toMatchObject({
      anchor: { key: text.key, offset: 1, type: 'text' },
    });
    expect(fixture.view.selection().format).toBe(0);
  } finally {
    fixture.close();
  }
});

// Source onSelectionChange runs its format rule even when the caret did not move.
test('a second independent same-caret selectionchange after the mark expires restores the anchor text format', () => {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'Linux x86_64',
  });
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
              children: [{ type: 'text', version: 1, text: 'ab' }],
            },
          ],
        },
      })
    );
    const text = [...fixture.view.mirror.values()].find((n) => n.text === 'ab');
    const textDOM = text && fixture.view.getElementByKey(text.key)?.firstChild;
    if (!text || !textDOM) throw new Error('Missing actual text');
    fixture.view.root.focus();
    const dom = document.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    dom.setBaseAndExtent(textDOM, 1, textDOM, 1);
    document.dispatchEvent(new Event('selectionchange'));
    fixture.view.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        code: 'KeyB',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.view.selection().format).toBe(1);
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 1000);
    // A click on the same caret.
    dom.setBaseAndExtent(textDOM, 1, textDOM, 1);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toMatchObject({
      anchor: { key: text.key, offset: 1, type: 'text' },
    });
    expect(fixture.view.selection().format).toBe(0);
  } finally {
    fixture.close();
  }
});

test('an owned DOM selection write is consumed once and its repeat commits nothing', () => {
  const fixture = nativeSurface();
  const hydration = (event: Event) => event.stopImmediatePropagation();
  document.addEventListener('selectionchange', hydration, true);
  try {
    fixture.root.tabIndex = 0;
    fixture.root.focus();
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'abcd' }],
            },
          ],
        },
      })
    );
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'abcd'
    );
    if (!leaf) throw new Error('Missing actual text');
    const interior = {
      kind: 'range' as const,
      anchor: { key: leaf.key, offset: 2, type: 'text' as const },
      focus: { key: leaf.key, offset: 2, type: 'text' as const },
    };
    // A model move writes the DOM caret and arms the own-write guard.
    fixture.port.selectionFromView({ ...interior, dirty: true });
    document.removeEventListener('selectionchange', hydration, true);
    fixture.counters.admissions = 0;
    const applied = vi.spyOn(fixture.view, 'apply');
    const writes = vi.spyOn(Selection.prototype, 'setBaseAndExtent');
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.counters.admissions).toBe(0);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.counters.admissions).toBe(1);
    expect(applied).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(fixture.view.selection().selection).toMatchObject(interior);
  } finally {
    document.removeEventListener('selectionchange', hydration, true);
    fixture.close();
  }
});

// Lexical.dev.mjs 3699-3710 and lexical_model selection/view.rs:230-240: an
// element anchor takes an empty element's text format and style, and a
// non-empty element keeps the created format but clears the style. The
// empty-root skip only differs when the anchor key is unchanged, which the
// created selection already covers.
test.each([
  {
    name: 'an empty element supplies its text format and style',
    children: [],
    format: 2,
    style: 'color: red',
  },
  {
    name: 'a non-empty element keeps the format and clears the style',
    children: [
      { type: 'linebreak', version: 1 },
      { type: 'text', version: 1, text: 'y', format: 0 },
    ],
    // The cache follows an explicit plain format (Lexical.dev.mjs 2430).
    // An omitted format is undefined and leaves the element cache unchanged.
    format: 0,
    style: '',
  },
])('element anchor: $name', ({ children, format, style }) => {
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
              children: [{ type: 'text', version: 1, text: 'x' }],
            },
            {
              type: 'paragraph',
              version: 1,
              textFormat: 2,
              textStyle: 'color: red',
              children,
            },
          ],
        },
      })
    );
    const [first, second] = fixture.root.querySelectorAll(':scope > p');
    const text = first?.firstChild?.firstChild;
    if (!second || !text) throw new Error('Missing actual paragraphs');
    fixture.view.root.focus();
    const dom = document.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    dom.setBaseAndExtent(text, 1, text, 1);
    document.dispatchEvent(new Event('selectionchange'));
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 1000);
    dom.setBaseAndExtent(second, 0, second, 0);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toMatchObject({
      anchor: { type: 'element', offset: 0 },
    });
    expect(fixture.view.selection().format).toBe(format);
    expect(fixture.view.selection().style).toBe(style);
  } finally {
    fixture.close();
  }
});
