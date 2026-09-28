import { describe, expect, it } from 'vitest';
import { parseGamePresence } from './presence';

describe('parseGamePresence', () => {
  it('keeps well-formed fields and drops the rest', () => {
    expect(
      parseGamePresence({
        activity: 'playing',
        score: 120,
        paddle: 22,
        court: {
          round: 1,
          seq: 9,
          since: 5,
          points: 2,
          ball: null,
          paddles: [30, 31],
        },
        extra: 'ignored',
      })
    ).toEqual({
      activity: 'playing',
      score: 120,
      paddle: 22,
      court: {
        round: 1,
        seq: 9,
        since: 5,
        points: 2,
        ball: undefined,
        paddles: [30, 31],
      },
    });
  });

  it('treats anything unexpected as someone watching', () => {
    expect(parseGamePresence('nope')).toEqual({ activity: 'watching' });
    expect(
      parseGamePresence({ activity: 'hacking', score: 'high', paddle: NaN })
    ).toEqual({ activity: 'watching' });
    expect(
      parseGamePresence({ activity: 'playing', court: { round: -1 } })
    ).toEqual({ activity: 'playing' });
  });
});
