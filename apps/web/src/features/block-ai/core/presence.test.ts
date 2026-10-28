import { describe, expect, it } from 'vitest';
import {
  isPresence,
  MAX_SESSION,
  NOWHERE,
  pickSession,
  storesFile,
} from './presence';

describe('presence', () => {
  it('recognizes presences this app writes', () => {
    expect(isPresence(NOWHERE)).toBe(true);
    expect(
      isPresence({
        session: 7,
        selection: [1, 2],
        cursor: { x: 1, y: 2 },
        editing: 3,
        editor: true,
        view: { x: 0, y: 0, w: 10, h: 10 },
      })
    ).toBe(true);
    expect(isPresence({ ...NOWHERE, selection: ['1'] })).toBe(false);
    // A Figma presence (pages, string ids) is not one.
    expect(
      isPresence({
        page: '0:1',
        selection: [],
        cursor: null,
        editing: null,
        editor: true,
        view: null,
      })
    ).toBe(false);
  });

  it('picks a session no one present uses', () => {
    expect(pickSession([], () => 0)).toBe(1);
    expect(pickSession([1, 2], () => 0)).toBe(3);
    expect(pickSession([], () => 0.999999)).toBe(MAX_SESSION);
    const taken = Array.from({ length: MAX_SESSION - 1 }, (_, i) => i + 1);
    expect(pickSession(taken, () => 0.5)).toBe(MAX_SESSION);
    for (let i = 0; i < 50; i++) {
      const s = pickSession([5, 6], Math.random);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(MAX_SESSION);
      expect([5, 6]).not.toContain(s);
    }
  });

  it('elects the editor with the lowest peer id to store the file', () => {
    const editor = (peerId: string) => ({
      peerId,
      presence: { ...NOWHERE, session: 1, editor: true },
    });
    const viewer = (peerId: string) => ({
      peerId,
      presence: { ...NOWHERE, session: 1 },
    });
    expect(storesFile({ peerId: '5', editor: true }, [editor('9')])).toBe(true);
    expect(storesFile({ peerId: '9', editor: true }, [editor('5')])).toBe(
      false
    );
    expect(storesFile({ peerId: '9', editor: true }, [viewer('5')])).toBe(true);
    expect(storesFile({ peerId: '1', editor: false }, [])).toBe(false);
  });
});
