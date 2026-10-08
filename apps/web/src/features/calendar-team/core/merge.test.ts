import { describe, expect, it } from 'vitest';
import { mergeCalendarOverlays } from './merge';

describe('calendar overlay composition', () => {
  it('keeps a directly accessible occurrence authoritative', () => {
    const own = { id: 'meeting', calendar: { id: 'own' }, isReadOnly: false };
    const team = { id: 'meeting', calendar: { id: 'team' }, isReadOnly: true };
    expect(mergeCalendarOverlays([own], [team], [team])).toEqual([own]);
  });

  it('replaces a shown teammate OOO source with their shared source only', () => {
    const aliceOoo = { id: 'alice-ooo', calendar: { id: 'team-ooo:alice' } };
    const bobOoo = { id: 'bob-ooo', calendar: { id: 'team-ooo:bob' } };
    const alice = {
      id: 'alice-team',
      calendar: { id: 'team-calendar:alice' },
      teamProjection: { ownerId: 'alice' },
    };
    expect(mergeCalendarOverlays([], [aliceOoo, bobOoo], [alice])).toEqual([
      bobOoo,
      alice,
    ]);
    expect(mergeCalendarOverlays([], [aliceOoo, bobOoo], [])).toEqual([
      aliceOoo,
      bobOoo,
    ]);
  });
});
