/** @vitest-environment jsdom */
import { afterEach, beforeAll, expect, test } from 'vitest';
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

// Source keyboardShortcutsPlugin DefaultShortcuts: physical key code with the
// platform Control-or-Meta key; code and highlight ignore Shift.
test.each([
  ['Linux x86_64', 'X', 'KeyX', { ctrlKey: true, shiftKey: true }, 4],
  ['MacIntel', 'x', 'KeyX', { metaKey: true, shiftKey: true }, 4],
  ['Linux x86_64', 'e', 'KeyE', { ctrlKey: true }, 16],
  ['MacIntel', 'e', 'KeyE', { metaKey: true }, 16],
  ['Linux x86_64', 'E', 'KeyE', { ctrlKey: true, shiftKey: true }, 16],
  ['Linux x86_64', 'H', 'KeyH', { ctrlKey: true, shiftKey: true }, 128],
  ['MacIntel', 'h', 'KeyH', { metaKey: true, shiftKey: true }, 128],
  ['Linux x86_64', 'h', 'KeyH', { ctrlKey: true }, 128],
  ['Linux x86_64', 'у', 'KeyE', { ctrlKey: true }, 16],
  ['Linux x86_64', 'b', 'KeyB', { ctrlKey: true }, 1],
] as const)(
  '%s %s (%s) with %j formats the selection with bit %d',
  (platform, key, code, modifiers, bit) => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: platform,
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
                children: [{ type: 'text', version: 1, text: 'hello' }],
              },
            ],
          },
        })
      );
      const text = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'hello'
      );
      const leaf = text && fixture.view.getElementByKey(text.key)?.firstChild;
      const dom = document.getSelection();
      if (!text || !leaf || !dom) throw new Error('Missing actual text');
      fixture.view.root.focus();
      dom.setBaseAndExtent(leaf, 0, leaf, 5);
      document.dispatchEvent(new Event('selectionchange'));
      const event = new KeyboardEvent('keydown', {
        key,
        code,
        ...modifiers,
        bubbles: true,
        cancelable: true,
      });
      let propagated = false;
      const outer = () => {
        propagated = true;
      };
      document.addEventListener('keydown', outer);
      fixture.view.root.dispatchEvent(event);
      document.removeEventListener('keydown', outer);
      expect(event.defaultPrevented).toBe(true);
      expect(propagated).toBe(bit === 1);
      const formatted = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'hello'
      );
      expect((formatted?.textProps?.format ?? 0) & bit).toBe(bit);
    } finally {
      fixture.close();
    }
  }
);

test.each([
  ['Linux x86_64', 'x', 'KeyX', { ctrlKey: true }],
  ['Linux x86_64', 'e', 'KeyE', { metaKey: true }],
  ['MacIntel', 'e', 'KeyE', { ctrlKey: true }],
] as const)(
  '%s %s (%s) with %j is not a format shortcut',
  (platform, key, code, modifiers) => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: platform,
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
                children: [{ type: 'text', version: 1, text: 'hello' }],
              },
            ],
          },
        })
      );
      const text = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'hello'
      );
      const leaf = text && fixture.view.getElementByKey(text.key)?.firstChild;
      const dom = document.getSelection();
      if (!text || !leaf || !dom) throw new Error('Missing actual text');
      fixture.view.root.focus();
      dom.setBaseAndExtent(leaf, 0, leaf, 5);
      document.dispatchEvent(new Event('selectionchange'));
      fixture.view.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code,
          ...modifiers,
          bubbles: true,
          cancelable: true,
        })
      );
      const after = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'hello'
      );
      expect(after?.textProps?.format ?? 0).toBe(0);
    } finally {
      fixture.close();
    }
  }
);
