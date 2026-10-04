import { describe, expect, it } from 'vitest';
import { type KeyInput, shortcutAction } from './shortcuts';

const key = (
  k: string,
  code: string,
  mods: Partial<Omit<KeyInput, 'key' | 'code'>> = {}
): KeyInput => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('viewer shortcuts', () => {
  it('maps Figma’s zoom shortcuts', () => {
    expect(shortcutAction(key(')', 'Digit0', { shiftKey: true }), true)).toBe(
      'zoom-100'
    );
    expect(shortcutAction(key('!', 'Digit1', { shiftKey: true }), true)).toBe(
      'zoom-fit'
    );
    expect(shortcutAction(key('@', 'Digit2', { shiftKey: true }), true)).toBe(
      'zoom-selection'
    );
    expect(shortcutAction(key('=', 'Equal', { metaKey: true }), true)).toBe(
      'zoom-in'
    );
    expect(shortcutAction(key('-', 'Minus', { ctrlKey: true }), false)).toBe(
      'zoom-out'
    );
    expect(shortcutAction(key('=', 'Equal'), true)).toBe('zoom-in');
  });

  it('uses ⌘ on macOS and Ctrl elsewhere', () => {
    expect(shortcutAction(key('a', 'KeyA', { metaKey: true }), true)).toBe(
      'select-all'
    );
    expect(shortcutAction(key('a', 'KeyA', { ctrlKey: true }), true)).toBe(
      undefined
    );
    expect(shortcutAction(key('a', 'KeyA', { ctrlKey: true }), false)).toBe(
      'select-all'
    );
  });

  it('opens the shortcuts panel with Ctrl+⇧+? on every platform', () => {
    const help = key('?', 'Slash', { ctrlKey: true, shiftKey: true });
    expect(shortcutAction(help, true)).toBe('show-shortcuts');
    expect(shortcutAction(help, false)).toBe('show-shortcuts');
    expect(shortcutAction(key('?', 'Slash', { shiftKey: true }), false)).toBe(
      'show-shortcuts'
    );
  });

  it('maps tools, navigation, and selection keys', () => {
    expect(shortcutAction(key('v', 'KeyV'), true)).toBe('tool-move');
    expect(shortcutAction(key('H', 'KeyH'), true)).toBe('tool-hand');
    expect(shortcutAction(key('n', 'KeyN'), true)).toBe('next-frame');
    expect(shortcutAction(key('N', 'KeyN', { shiftKey: true }), true)).toBe(
      'previous-frame'
    );
    expect(shortcutAction(key('PageDown', 'PageDown'), true)).toBe('next-page');
    expect(shortcutAction(key('Enter', 'Enter'), true)).toBe('select-children');
    expect(
      shortcutAction(key('Enter', 'Enter', { shiftKey: true }), true)
    ).toBe('select-parent');
    expect(shortcutAction(key('Tab', 'Tab', { shiftKey: true }), true)).toBe(
      'previous-sibling'
    );
    expect(shortcutAction(key('Escape', 'Escape'), true)).toBe('escape');
  });

  it('maps view toggles and exports', () => {
    expect(
      shortcutAction(key('\\', 'Backslash', { metaKey: true }), true)
    ).toBe('toggle-ui');
    expect(shortcutAction(key('y', 'KeyY', { metaKey: true }), true)).toBe(
      'toggle-outline'
    );
    expect(shortcutAction(key('R', 'KeyR', { shiftKey: true }), true)).toBe(
      'toggle-rulers'
    );
    expect(shortcutAction(key('¡', 'Digit1', { altKey: true }), true)).toBe(
      'toggle-layers'
    );
    expect(
      shortcutAction(key('C', 'KeyC', { metaKey: true, shiftKey: true }), true)
    ).toBe('copy-png');
  });

  it('ignores unrelated keys', () => {
    expect(shortcutAction(key('q', 'KeyQ'), true)).toBeUndefined();
    expect(shortcutAction(key('s', 'KeyS', { metaKey: true }), true)).toBe(
      undefined
    );
  });
});

describe('editing shortcuts', () => {
  it('maps Figma’s tools', () => {
    expect(shortcutAction(key('r', 'KeyR'), true)).toBe('tool-rectangle');
    expect(shortcutAction(key('f', 'KeyF'), true)).toBe('tool-frame');
    expect(shortcutAction(key('a', 'KeyA'), true)).toBe('tool-frame');
    expect(shortcutAction(key('o', 'KeyO'), true)).toBe('tool-ellipse');
    expect(shortcutAction(key('t', 'KeyT'), true)).toBe('tool-text');
  });

  it('maps edit commands with ⌘ (Ctrl elsewhere)', () => {
    expect(shortcutAction(key('z', 'KeyZ', { metaKey: true }), true)).toBe(
      'undo'
    );
    expect(
      shortcutAction(key('z', 'KeyZ', { metaKey: true, shiftKey: true }), true)
    ).toBe('redo');
    expect(shortcutAction(key('d', 'KeyD', { ctrlKey: true }), false)).toBe(
      'duplicate'
    );
    expect(shortcutAction(key('g', 'KeyG', { metaKey: true }), true)).toBe(
      'group'
    );
    expect(
      shortcutAction(key('g', 'KeyG', { metaKey: true, shiftKey: true }), true)
    ).toBe('ungroup');
    expect(
      shortcutAction(key('©', 'KeyG', { metaKey: true, altKey: true }), true)
    ).toBe('frame-selection');
    expect(
      shortcutAction(key(']', 'BracketRight', { metaKey: true }), true)
    ).toBe('bring-forward');
    expect(
      shortcutAction(
        key('‘', 'BracketRight', { metaKey: true, altKey: true }),
        true
      )
    ).toBe('bring-to-front');
  });

  it('adds and removes auto layout', () => {
    expect(shortcutAction(key('A', 'KeyA', { shiftKey: true }), true)).toBe(
      'add-auto-layout'
    );
    expect(
      shortcutAction(key('Å', 'KeyA', { shiftKey: true, altKey: true }), true)
    ).toBe('remove-auto-layout');
  });

  it('nudges with the arrows', () => {
    expect(shortcutAction(key('ArrowLeft', 'ArrowLeft'), true)).toBe(
      'nudge-left'
    );
    expect(
      shortcutAction(key('ArrowDown', 'ArrowDown', { shiftKey: true }), true)
    ).toBe('nudge-down-10');
    expect(shortcutAction(key('Backspace', 'Backspace'), true)).toBe('delete');
  });
});
