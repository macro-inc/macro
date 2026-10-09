import { describe, expect, it } from 'vitest';
import {
  type KeyInput,
  keyLabel,
  nudgeOffset,
  shortcutAction,
} from './shortcuts';

const key = (code: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: code.replace(/^Key/, '').toLowerCase(),
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe('shortcutAction', () => {
  it('picks tools by letter', () => {
    expect(shortcutAction(key('KeyV'), true)).toBe('tool-select');
    expect(shortcutAction(key('KeyA'), true)).toBe('tool-direct');
    expect(shortcutAction(key('KeyP'), true)).toBe('tool-pen');
    expect(shortcutAction(key('KeyM'), true)).toBe('tool-rectangle');
    expect(shortcutAction(key('KeyL'), true)).toBe('tool-ellipse');
    expect(shortcutAction(key('Backslash'), true)).toBe('tool-line');
    expect(shortcutAction(key('KeyT'), true)).toBe('tool-type');
    expect(shortcutAction(key('KeyI'), true)).toBe('tool-eyedropper');
    expect(shortcutAction(key('KeyO', { shiftKey: true }), true)).toBe(
      'tool-artboard'
    );
    expect(shortcutAction(key('KeyH'), true)).toBe('tool-hand');
    expect(shortcutAction(key('KeyZ'), true)).toBe('tool-zoom');
  });

  it('runs commands with ⌘ on a Mac and Ctrl elsewhere', () => {
    const mac = (code: string, extra: Partial<KeyInput> = {}) =>
      shortcutAction(key(code, { metaKey: true, ...extra }), true);
    expect(mac('KeyZ')).toBe('undo');
    expect(mac('KeyZ', { shiftKey: true })).toBe('redo');
    expect(mac('KeyG')).toBe('group');
    expect(mac('KeyG', { shiftKey: true })).toBe('ungroup');
    expect(mac('Digit7')).toBe('make-clip');
    expect(mac('Digit7', { altKey: true })).toBe('release-clip');
    expect(mac('BracketRight')).toBe('bring-forward');
    expect(mac('BracketRight', { shiftKey: true })).toBe('bring-to-front');
    expect(mac('BracketLeft')).toBe('send-backward');
    expect(mac('BracketLeft', { shiftKey: true })).toBe('send-to-back');
    expect(mac('KeyD')).toBe('duplicate');
    expect(mac('KeyY')).toBe('toggle-outline');
    expect(mac('KeyO', { shiftKey: true })).toBe('create-outlines');
    expect(mac('Digit0')).toBe('zoom-fit');
    expect(mac('Digit0', { altKey: true })).toBe('zoom-fit-all');
    expect(mac('Digit1')).toBe('zoom-100');
    expect(mac('Equal', { shiftKey: true })).toBe('zoom-in');
    expect(mac('Minus')).toBe('zoom-out');
    expect(mac('KeyA')).toBe('select-all');
    expect(mac('KeyA', { shiftKey: true })).toBe('deselect');
    expect(shortcutAction(key('KeyZ', { ctrlKey: true }), false)).toBe('undo');
    // Ctrl on a Mac is not ⌘.
    expect(
      shortcutAction(key('KeyZ', { ctrlKey: true }), true)
    ).toBeUndefined();
  });

  it('nudges with the arrows and edits with the other keys', () => {
    expect(
      shortcutAction({ ...key('ArrowLeft'), key: 'ArrowLeft' }, true)
    ).toBe('nudge-left');
    expect(
      shortcutAction(
        { ...key('ArrowDown', { shiftKey: true }), key: 'ArrowDown' },
        true
      )
    ).toBe('nudge-down-10');
    expect(
      shortcutAction({ ...key('Backspace'), key: 'Backspace' }, true)
    ).toBe('delete');
    expect(shortcutAction({ ...key('Escape'), key: 'Escape' }, true)).toBe(
      'escape'
    );
    expect(shortcutAction(key('KeyD'), true)).toBe('default-colors');
    expect(shortcutAction(key('KeyX', { shiftKey: true }), true)).toBe(
      'swap-colors'
    );
    expect(nudgeOffset('nudge-up-10')).toEqual({ dx: 0, dy: -10 });
    expect(nudgeOffset('nudge-right')).toEqual({ dx: 1, dy: 0 });
    expect(nudgeOffset('undo')).toBeUndefined();
  });

  it('labels shortcuts for the platform', () => {
    expect(keyLabel('⇧⌘G', true)).toBe('⇧⌘G');
    expect(keyLabel('⇧⌘G', false)).toBe('Shift+Ctrl+G');
  });
});
