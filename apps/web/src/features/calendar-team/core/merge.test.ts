import { describe, expect, it } from 'vitest';
import { mergeCalendarOverlays } from './merge';

describe('calendar overlay composition', () => {
  it('keeps a directly accessible occurrence authoritative', () => {
    const own = { id: 'meeting', calendar: { id: 'own' }, isReadOnly: false };
    const team = { id: 'meeting', calendar: { id: 'team' }, isReadOnly: true };
    expect(mergeCalendarOverlays([own], [team])).toEqual([own]);
  });

  it('adds teammate OOO the viewer cannot read directly', () => {
    const own = { id: 'meeting', calendar: { id: 'own' } };
    const bobOoo = { id: 'bob-ooo', calendar: { id: 'team-ooo:bob' } };
    expect(mergeCalendarOverlays([own], [bobOoo])).toEqual([own, bobOoo]);
  });
});
