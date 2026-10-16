import { describe, expect, it } from 'vitest';
import {
  chooseSession,
  isPresence,
  NOWHERE,
  type PsdPresence,
  shareSelection,
  storesFile,
} from './presence';

const presence = (editor: boolean): PsdPresence => ({ ...NOWHERE, editor });

describe('presence', () => {
  it('validates published values', () => {
    expect(isPresence(NOWHERE)).toBe(true);
    expect(
      isPresence({
        ...NOWHERE,
        session: 7,
        cursor: { x: 1, y: 2 },
        layers: [3],
        selection: {
          bounds: { x: 0, y: 0, w: 4, h: 4 },
          outline: [[0, 0, 4, 0, 4, 4]],
        },
        view: { x: 0, y: 0, w: 10, h: 10 },
        editing: 3,
      })
    ).toBe(true);
    expect(isPresence({ ...NOWHERE, layers: ['3'] })).toBe(false);
    expect(isPresence({ ...NOWHERE, selection: { outline: [] } })).toBe(false);
    expect(isPresence(null)).toBe(false);
  });

  it('shares selection outlines within a budget', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const big: [number, number][] = Array.from({ length: 1000 }, (_, i) => [
      Math.cos(i / 100) * 50.123,
      Math.sin(i / 100) * 50.123,
    ]);
    const shared = shareSelection(
      { bounds: { x: -50, y: -50, w: 100, h: 100 }, outline: [square, big] },
      200
    );
    if (!shared) throw new Error('no selection');
    const points = shared.outline.reduce((n, p) => n + p.length / 2, 0);
    expect(points).toBeLessThanOrEqual(210);
    expect(shared.outline).toHaveLength(2);
    expect(shared.outline[0][0]).toBe(50.1);
    expect(shareSelection({ bounds: null, outline: [] })).toBeNull();
  });

  it('elects the editor with the lowest peer id to store', () => {
    expect(
      storesFile({ peerId: '5', editor: true }, [
        { peerId: '9', presence: presence(true) },
        { peerId: '2', presence: presence(false) },
      ])
    ).toBe(true);
    expect(
      storesFile({ peerId: '5', editor: true }, [
        { peerId: '3', presence: presence(true) },
      ])
    ).toBe(false);
    expect(storesFile({ peerId: '1', editor: false }, [])).toBe(false);
  });

  it('chooses a session nobody uses', () => {
    let calls = 0;
    // The first two draws are taken.
    const draws = [0, 0, 0.5];
    const session = chooseSession(new Set([1]), () => draws[calls++] ?? 0.9);
    expect(session).toBe(1 + Math.floor(0.5 * 0xffff));
    expect(chooseSession(new Set())).toBeGreaterThanOrEqual(1);
    expect(chooseSession(new Set())).toBeLessThanOrEqual(0xffff);
  });
});
