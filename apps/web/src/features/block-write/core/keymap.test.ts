import { describe, expect, it } from 'vitest';
import { keyAction } from './keymap';

const key = (
  key: string,
  mods: Partial<{
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }> = {},
  code = key.length === 1 ? `Key${key.toUpperCase()}` : key
) => ({
  key,
  code,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('keyAction', () => {
  it('moves by platform word and line conventions', () => {
    expect(keyAction(key('ArrowLeft', { altKey: true }), true)).toEqual({
      kind: 'ops',
      ops: [{ op: 'move', unit: 'word', forward: false, extend: false }],
    });
    expect(keyAction(key('ArrowRight', { ctrlKey: true }), false)).toEqual({
      kind: 'ops',
      ops: [{ op: 'move', unit: 'word', forward: true, extend: false }],
    });
    expect(
      keyAction(key('ArrowRight', { metaKey: true, shiftKey: true }), true)
    ).toEqual({
      kind: 'ops',
      ops: [{ op: 'move', unit: 'lineBoundary', forward: true, extend: true }],
    });
    expect(keyAction(key('End', { ctrlKey: true }), false)).toEqual({
      kind: 'ops',
      ops: [{ op: 'move', unit: 'document', forward: true, extend: false }],
    });
  });

  it('maps editing keys', () => {
    expect(keyAction(key('Enter'), false)).toEqual({
      kind: 'ops',
      ops: [{ op: 'insertParagraph' }],
    });
    expect(keyAction(key('Enter', { shiftKey: true }), false)).toEqual({
      kind: 'ops',
      ops: [{ op: 'insertBreak', kind: 'line' }],
    });
    expect(keyAction(key('Backspace', { altKey: true }), true)).toEqual({
      kind: 'ops',
      ops: [{ op: 'delete', forward: false, unit: 'word' }],
      group: 'delete',
    });
    expect(keyAction(key('Tab', { shiftKey: true }), false)).toEqual({
      kind: 'tab',
      forward: false,
    });
  });

  it('maps formatting and history shortcuts', () => {
    expect(keyAction(key('b', { metaKey: true }), true)).toEqual({
      kind: 'ops',
      ops: [{ op: 'toggleFormat', format: 'bold' }],
    });
    expect(
      keyAction(key('z', { ctrlKey: true, shiftKey: true }), false)
    ).toEqual({ kind: 'redo' });
    expect(keyAction(key('y', { ctrlKey: true }), false)).toEqual({
      kind: 'redo',
    });
    expect(keyAction(key('m', { metaKey: true, altKey: true }), true)).toEqual({
      kind: 'comment',
    });
  });

  it('leaves typing and clipboard keys to the browser', () => {
    expect(keyAction(key('a'), false)).toBeNull();
    expect(keyAction(key('c', { ctrlKey: true }), false)).toBeNull();
    expect(keyAction(key('v', { metaKey: true }), true)).toBeNull();
  });
});
