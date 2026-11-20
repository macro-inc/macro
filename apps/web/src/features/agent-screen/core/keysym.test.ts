import { describe, expect, it } from 'vitest';
import { keysymForCharacter, keysymForKey } from './keysym';

describe('keysymForKey', () => {
  it('maps printable characters by code point', () => {
    expect(keysymForKey('a')).toBe(0x61);
    expect(keysymForKey('A')).toBe(0x41);
    expect(keysymForKey(' ')).toBe(0x20);
    expect(keysymForKey('é')).toBe(0xe9);
    expect(keysymForKey('€')).toBe(0x010020ac);
    expect(keysymForKey('😀')).toBe(0x0101f600);
  });

  it('maps named keys and right-hand modifiers', () => {
    expect(keysymForKey('Enter')).toBe(0xff0d);
    expect(keysymForKey('ArrowLeft')).toBe(0xff51);
    expect(keysymForKey('F12')).toBe(0xffc9);
    expect(keysymForKey('Shift')).toBe(0xffe1);
    expect(keysymForKey('Shift', 2)).toBe(0xffe2);
  });

  it('ignores keys with no keysym', () => {
    expect(keysymForKey('Unidentified')).toBe(undefined);
    expect(keysymForKey('Dead')).toBe(undefined);
    expect(keysymForCharacter('\n')).toBe(undefined);
  });
});
