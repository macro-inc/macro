/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { isExactShortcutMatch } from 'lexical';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);
const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
afterEach(() => {
  if (originalPlatform)
    Object.defineProperty(navigator, 'platform', originalPlatform);
  else Reflect.deleteProperty(navigator, 'platform');
});

test.each([
  ['Linux x86_64', 'a', 'KeyA', { ctrlKey: true }, CommandCode.SelectAll],
  ['MacIntel', 'a', 'KeyA', { metaKey: true }, CommandCode.SelectAll],
  ['Linux x86_64', 'a', 'KeyA', { metaKey: true }, 0],
  ['MacIntel', 'a', 'KeyA', { ctrlKey: true }, 0],
  ['Linux x86_64', 'z', 'KeyZ', { ctrlKey: true }, CommandCode.Undo],
  ['MacIntel', 'z', 'KeyZ', { metaKey: true }, CommandCode.Undo],
  ['Linux x86_64', 'z', 'KeyZ', { metaKey: true }, 0],
  ['MacIntel', 'z', 'KeyZ', { ctrlKey: true }, 0],
  [
    'Linux x86_64',
    'z',
    'KeyZ',
    { ctrlKey: true, shiftKey: true },
    CommandCode.Redo,
  ],
  [
    'MacIntel',
    'z',
    'KeyZ',
    { metaKey: true, shiftKey: true },
    CommandCode.Redo,
  ],
  ['Linux x86_64', 'y', 'KeyY', { ctrlKey: true }, CommandCode.Redo],
  ['MacIntel', 'y', 'KeyY', { metaKey: true }, 0],
  ['Linux x86_64', 'y', 'KeyY', { ctrlKey: true, shiftKey: true }, 0],
  ['Linux x86_64', 'z', 'KeyZ', { ctrlKey: true, metaKey: true }, 0],
  ['Linux x86_64', 'z', 'KeyZ', { ctrlKey: true, altKey: true }, 0],
  ['MacIntel', 'z', 'KeyZ', { metaKey: true, altKey: true }, 0],
  ['Linux x86_64', 'a', 'KeyA', { ctrlKey: true, shiftKey: true }, 0],
  ['Linux x86_64', 'я', 'KeyZ', { ctrlKey: true }, CommandCode.Undo],
  ['Linux x86_64', 'x', 'KeyZ', { ctrlKey: true }, 0],
  ['Linux x86_64', 'Dead', 'KeyZ', { ctrlKey: true }, CommandCode.Undo],
  [
    'Linux x86_64',
    'Unidentified',
    'KeyA',
    { ctrlKey: true },
    CommandCode.SelectAll,
  ],
  ['Linux x86_64', '😀', 'KeyA', { ctrlKey: true }, CommandCode.SelectAll],
  ['Linux x86_64', 'a', 'KeyA', { ctrlKey: true, isComposing: true }, 0],
] as const)(
  'routes %s %s %s with %j to %s',
  (platform, key, code, modifiers, expected) => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: platform,
    });
    const fixture = nativeSurface();
    try {
      const down = vi.spyOn(fixture.port, 'keyDown');
      const event = new KeyboardEvent('keydown', {
        key,
        code,
        ...modifiers,
        bubbles: true,
        cancelable: true,
      });
      fixture.root.dispatchEvent(event);
      expect(down.mock.calls.at(-1)?.[2] ?? 0).toBe(expected);
      expect(event.defaultPrevented).toBe(expected !== 0);
    } finally {
      fixture.close();
    }
  }
);

test('Control+A selects both native paragraphs on a non-Apple platform', () => {
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
              children: [{ type: 'text', version: 1, text: 'first' }],
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'second' }],
            },
          ],
        },
      })
    );
    const doc = fixture.root.ownerDocument;
    const leaf = doc
      .createTreeWalker(fixture.root, NodeFilter.SHOW_TEXT)
      .nextNode();
    const dom = doc.getSelection();
    if (!leaf || !dom) throw new Error('Missing text caret');
    fixture.root.focus();
    dom.setBaseAndExtent(leaf, 2, leaf, 2);
    doc.dispatchEvent(new Event('selectionchange'));
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    const selection = fixture.view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range') throw new Error('Missing selected range');
    expect(selection.anchor).not.toEqual(selection.focus);
  } finally {
    fixture.close();
  }
});

test.each([
  ['Dead', 'KeyZ', 'z'],
  ['Unidentified', 'KeyA', 'a'],
  ['😀', 'KeyA', 'a'],
  ['я', 'KeyZ', 'z'],
] as const)(
  'actual Source accepts non-ASCII/layout key %s via %s',
  (key, code, expectedKey) => {
    const event = new KeyboardEvent('keydown', { key, code, ctrlKey: true });
    expect(isExactShortcutMatch(event, expectedKey, { ctrlKey: true })).toBe(
      true
    );
  }
);

test('a previously prevented key event keeps the Source shortcut match', () => {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'Linux x86_64',
  });
  const fixture = nativeSurface();
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    expect(isExactShortcutMatch(event, 'a', { ctrlKey: true })).toBe(true);
    const down = vi.spyOn(fixture.port, 'keyDown');
    fixture.root.dispatchEvent(event);
    expect(down.mock.calls.at(-1)?.[2]).toBe(CommandCode.SelectAll);
  } finally {
    fixture.close();
  }
});

test('AltGraph follows the actual modifier flags without a separate shortcut exception', () => {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'Linux x86_64',
  });
  const fixture = nativeSurface();
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const altGraph = vi.spyOn(event, 'getModifierState').mockReturnValue(true);
    expect(isExactShortcutMatch(event, 'a', { ctrlKey: true })).toBe(false);
    const down = vi.spyOn(fixture.port, 'keyDown');
    fixture.root.dispatchEvent(event);
    expect(down.mock.calls.at(-1)?.[2] ?? 0).toBe(0);
    expect(altGraph).not.toHaveBeenCalled();
  } finally {
    fixture.close();
  }
});
