import { describe, expect, it } from 'vitest';
import {
  controlOwnsKey,
  isCommitKey,
  type KeyInput,
  shortcutAction,
} from './shortcuts';

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

  it('toggles layout grids with ⌃G on macOS and Ctrl+⇧4 elsewhere', () => {
    expect(shortcutAction(key('g', 'KeyG', { ctrlKey: true }), true)).toBe(
      'toggle-layout-grids'
    );
    expect(shortcutAction(key('g', 'KeyG', { ctrlKey: true }), false)).toBe(
      'group'
    );
    expect(
      shortcutAction(
        key('$', 'Digit4', { ctrlKey: true, shiftKey: true }),
        false
      )
    ).toBe('toggle-layout-grids');
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

  it('makes components and detaches instances', () => {
    expect(
      shortcutAction(key('˚', 'KeyK', { metaKey: true, altKey: true }), true)
    ).toBe('create-component');
    expect(
      shortcutAction(key('b', 'KeyB', { ctrlKey: true, altKey: true }), false)
    ).toBe('detach-instance');
  });

  it('adds and removes auto layout', () => {
    expect(shortcutAction(key('A', 'KeyA', { shiftKey: true }), true)).toBe(
      'add-auto-layout'
    );
    expect(
      shortcutAction(key('Å', 'KeyA', { shiftKey: true, altKey: true }), true)
    ).toBe('remove-auto-layout');
  });

  it('combines shapes and flattens them', () => {
    const boolean = (k: string, code: string) =>
      shortcutAction(key(k, code, { shiftKey: true, altKey: true }), true);
    expect(boolean('¨', 'KeyU')).toBe('boolean-union');
    expect(boolean('Í', 'KeyS')).toBe('boolean-subtract');
    expect(boolean('ˆ', 'KeyI')).toBe('boolean-intersect');
    expect(boolean('˛', 'KeyX')).toBe('boolean-exclude');
    expect(shortcutAction(key('e', 'KeyE', { metaKey: true }), true)).toBe(
      'flatten'
    );
    expect(shortcutAction(key('e', 'KeyE', { ctrlKey: true }), false)).toBe(
      'flatten'
    );
    // ⇧⌘E stays export.
    expect(
      shortcutAction(key('E', 'KeyE', { metaKey: true, shiftKey: true }), true)
    ).toBe('export');
    expect(shortcutAction(key('p', 'KeyP'), true)).toBe('tool-pen');
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

describe('focused controls and text fields', () => {
  it('commits on Enter, but not while an input method composes', () => {
    expect(isCommitKey({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(
      true
    );
    expect(isCommitKey({ key: 'Enter', isComposing: true, keyCode: 13 })).toBe(
      false
    );
    expect(
      isCommitKey({ key: 'Enter', isComposing: false, keyCode: 229 })
    ).toBe(false);
    expect(isCommitKey({ key: 'a', isComposing: false, keyCode: 65 })).toBe(
      false
    );
  });

  it('leaves selects their keys, and buttons Space and Enter', () => {
    const k = (key: string, mod = false) => ({
      key,
      metaKey: mod,
      ctrlKey: false,
    });
    expect(controlOwnsKey('SELECT', k('ArrowDown'))).toBe(true);
    expect(controlOwnsKey('SELECT', k('Backspace'))).toBe(true);
    expect(controlOwnsKey('BUTTON', k(' '))).toBe(true);
    expect(controlOwnsKey('BUTTON', k('Enter'))).toBe(true);
    expect(controlOwnsKey('BUTTON', k('Delete'))).toBe(false);
    expect(controlOwnsKey('SELECT', k('z', true))).toBe(false);
  });
});

describe('Figma shortcuts added for parity', () => {
  it('opens the actions menu with ⌘P and ⌘/ (never printing)', () => {
    expect(shortcutAction(key('p', 'KeyP', { metaKey: true }), true)).toBe(
      'open-actions'
    );
    expect(shortcutAction(key('p', 'KeyP', { ctrlKey: true }), false)).toBe(
      'open-actions'
    );
    expect(shortcutAction(key('/', 'Slash', { metaKey: true }), true)).toBe(
      'open-actions'
    );
  });

  it('leaves ⌘K to the app’s command menu', () => {
    expect(
      shortcutAction(key('k', 'KeyK', { metaKey: true }), true)
    ).toBeUndefined();
    expect(
      shortcutAction(key('k', 'KeyK', { metaKey: true, altKey: true }), true)
    ).toBe('create-component');
  });

  it('shows and hides the UI with ⌘. as well as ⌘\\', () => {
    expect(shortcutAction(key('.', 'Period', { metaKey: true }), true)).toBe(
      'toggle-ui'
    );
    expect(
      shortcutAction(key('\\', 'Backslash', { metaKey: true }), true)
    ).toBe('toggle-ui');
  });

  it('picks the pencil with ⇧P and the pen with P', () => {
    expect(shortcutAction(key('P', 'KeyP', { shiftKey: true }), true)).toBe(
      'tool-pencil'
    );
    expect(shortcutAction(key('p', 'KeyP'), true)).toBe('tool-pen');
  });

  it('aligns with ⌥ letters, and ⌥ letters on macOS whatever they type', () => {
    const alt = (k: string, code: string) =>
      shortcutAction(key(k, code, { altKey: true }), true);
    expect(alt('å', 'KeyA')).toBe('align-left');
    expect(alt('˙', 'KeyH')).toBe('align-center');
    expect(alt('∂', 'KeyD')).toBe('align-right');
    expect(alt('∑', 'KeyW')).toBe('align-top');
    expect(alt('√', 'KeyV')).toBe('align-middle');
    expect(alt('ß', 'KeyS')).toBe('align-bottom');
    expect(alt('¬', 'KeyL')).toBe('collapse-layers');
    expect(alt('™', 'Digit2')).toBe('toggle-assets');
  });

  it('distributes with ⌃⌥H and ⌃⌥V', () => {
    expect(
      shortcutAction(key('h', 'KeyH', { ctrlKey: true, altKey: true }), true)
    ).toBe('distribute-horizontal');
    expect(
      shortcutAction(key('v', 'KeyV', { ctrlKey: true, altKey: true }), false)
    ).toBe('distribute-vertical');
  });

  it('excludes with ⌥⇧E (and ⌥⇧X)', () => {
    const mods = { altKey: true, shiftKey: true };
    expect(shortcutAction(key('E', 'KeyE', mods), true)).toBe(
      'boolean-exclude'
    );
    expect(shortcutAction(key('X', 'KeyX', mods), true)).toBe(
      'boolean-exclude'
    );
  });

  it('sets opacity with digits, leaving ⇧digits to zoom', () => {
    expect(shortcutAction(key('5', 'Digit5'), true)).toBe('opacity-5');
    expect(shortcutAction(key('0', 'Digit0'), true)).toBe('opacity-0');
    expect(shortcutAction(key('!', 'Digit1', { shiftKey: true }), true)).toBe(
      'zoom-fit'
    );
  });

  it('maps swap fill and stroke, place image, and paste to replace', () => {
    expect(shortcutAction(key('X', 'KeyX', { shiftKey: true }), true)).toBe(
      'swap-fill-stroke'
    );
    expect(
      shortcutAction(key('k', 'KeyK', { metaKey: true, shiftKey: true }), true)
    ).toBe('place-image');
    expect(
      shortcutAction(key('r', 'KeyR', { metaKey: true, shiftKey: true }), true)
    ).toBe('paste-replace');
  });
});
