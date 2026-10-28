import { describe, expect, it } from 'vitest';
import {
  type FigPresence,
  initials,
  isPresence,
  NOWHERE,
  newGuidSession,
  storesFile,
  versionCovers,
} from './presence';

const here: FigPresence = {
  page: '0:1',
  selection: ['1:2', '1:3'],
  cursor: { x: 10, y: -4.5 },
  editing: null,
  editor: true,
  view: { x: 0, y: 0, w: 800, h: 600 },
};

describe('presence', () => {
  it('accepts presences and rejects anything else', () => {
    expect(isPresence(here)).toBe(true);
    expect(isPresence(NOWHERE)).toBe(true);
    expect(isPresence({ ...here, cursor: { x: 'a', y: 1 } })).toBe(false);
    expect(isPresence({ ...here, selection: [1] })).toBe(false);
    expect(isPresence({ ...here, view: { x: 0, y: 0 } })).toBe(false);
    expect(isPresence({ slide: 1, shapes: [] })).toBe(false);
    expect(isPresence(null)).toBe(false);
  });

  it('elects the editor with the lowest peer id to store the file', () => {
    const peer = (peerId: string, editor: boolean) => ({
      peerId,
      presence: { ...here, editor },
    });
    // Peer ids are 64-bit: compared as numbers, not strings.
    const others = [peer('900', true), peer('12', false)];
    expect(storesFile({ peerId: '100', editor: true }, others)).toBe(true);
    expect(
      storesFile({ peerId: '100', editor: true }, [...others, peer('99', true)])
    ).toBe(false);
    expect(storesFile({ peerId: '1', editor: false }, others)).toBe(false);
    expect(
      storesFile({ peerId: '18446744073709551615', editor: true }, [])
    ).toBe(true);
  });

  it('knows when a stored version includes what was seen', () => {
    expect(versionCovers({ a: 3, b: 1 }, { a: 2, b: 1 })).toBe(true);
    expect(versionCovers({ a: 3 }, { a: 2, b: 1 })).toBe(false);
    expect(versionCovers({}, {})).toBe(true);
  });

  it('makes initials and guid sessions', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  ')).toBe('?');
    expect(newGuidSession(() => 0)).toBe(1 << 20);
    expect(newGuidSession(() => 0.999999999)).toBeLessThan(2 ** 31);
  });
});
