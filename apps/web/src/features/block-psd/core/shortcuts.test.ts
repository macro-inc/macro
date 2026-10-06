import { describe, expect, it } from 'vitest';
import { type KeyLike, keyAction, stepBrushSize } from './shortcuts';

function key(code: string, mods: Partial<KeyLike> = {}, k?: string): KeyLike {
  return {
    code,
    key: k ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code),
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe('shortcuts', () => {
  it('maps ⌘ commands (Ctrl off macOS)', () => {
    expect(keyAction(key('KeyZ', { metaKey: true }), true)).toEqual({
      t: 'command',
      command: 'undo',
    });
    expect(
      keyAction(key('KeyZ', { metaKey: true, shiftKey: true }), true)
    ).toEqual({
      t: 'command',
      command: 'redo',
    });
    expect(keyAction(key('KeyZ', { ctrlKey: true }), false)).toEqual({
      t: 'command',
      command: 'undo',
    });
    // Ctrl on a Mac is not ⌘.
    expect(keyAction(key('KeyZ', { ctrlKey: true }), true)).toBeUndefined();
    expect(keyAction(key('KeyT', { metaKey: true }), true)).toEqual({
      t: 'command',
      command: 'freeTransform',
    });
    expect(
      keyAction(key('KeyI', { metaKey: true, shiftKey: true }), true)
    ).toEqual({
      t: 'command',
      command: 'invertSelection',
    });
    expect(keyAction(key('Digit0', { metaKey: true }), true)).toEqual({
      t: 'command',
      command: 'zoomFit',
    });
    expect(
      keyAction(key('KeyG', { metaKey: true, altKey: true }), true)
    ).toEqual({
      t: 'command',
      command: 'clippingMask',
    });
    // The app keeps ⌘K and ⌘S.
    expect(keyAction(key('KeyK', { metaKey: true }), true)).toBeUndefined();
    expect(keyAction(key('KeyS', { metaKey: true }), true)).toBeUndefined();
  });

  it('maps tools, colors, and brush keys', () => {
    expect(keyAction(key('KeyB'), true)).toEqual({
      t: 'tool',
      key: 'B',
      cycle: false,
    });
    expect(keyAction(key('KeyM', { shiftKey: true }), true)).toEqual({
      t: 'tool',
      key: 'M',
      cycle: true,
    });
    expect(keyAction(key('KeyX'), true)).toEqual({
      t: 'command',
      command: 'swapColors',
    });
    expect(keyAction(key('BracketRight', {}, ']'), true)).toEqual({
      t: 'command',
      command: 'brushLarger',
    });
    expect(
      keyAction(key('BracketLeft', { shiftKey: true }, '{'), true)
    ).toEqual({
      t: 'command',
      command: 'brushSofter',
    });
    expect(keyAction(key('Digit5', {}, '5'), true)).toEqual({
      t: 'opacity',
      value: 5,
    });
    expect(keyAction(key('KeyQ'), true)).toBeUndefined();
  });

  it('nudges, deletes, and fills', () => {
    expect(
      keyAction(key('ArrowLeft', { shiftKey: true }, 'ArrowLeft'), true)
    ).toEqual({
      t: 'nudge',
      dx: -10,
      dy: 0,
    });
    expect(keyAction(key('Backspace', {}, 'Backspace'), true)).toEqual({
      t: 'command',
      command: 'delete',
    });
    expect(
      keyAction(key('Backspace', { altKey: true }, 'Backspace'), true)
    ).toEqual({
      t: 'command',
      command: 'fillForeground',
    });
    expect(
      keyAction(key('Backspace', { metaKey: true }, 'Backspace'), true)
    ).toEqual({
      t: 'command',
      command: 'fillBackground',
    });
    expect(keyAction(key('Enter', {}, 'Enter'), true)).toEqual({
      t: 'command',
      command: 'commit',
    });
  });

  it('steps brush sizes as Photoshop does', () => {
    expect(stepBrushSize(5, 1)).toBe(6);
    expect(stepBrushSize(20, 1)).toBe(30);
    expect(stepBrushSize(20, -1)).toBe(10);
    expect(stepBrushSize(10, -1)).toBe(9);
    expect(stepBrushSize(1, -1)).toBe(1);
    expect(stepBrushSize(150, 1)).toBe(175);
    expect(stepBrushSize(5000, 1)).toBe(5000);
  });
});
