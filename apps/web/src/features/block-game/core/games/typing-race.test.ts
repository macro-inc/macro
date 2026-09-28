import { describe, expect, it } from 'vitest';
import type { GameLogEntry } from '../game-log';
import {
  parseRacerProgress,
  RACE_TIME_LIMIT_MS,
  type RacerProgress,
  raceStage,
  raceStandings,
  replayTypingRace,
  TYPING_PASSAGES,
  typingProgress,
  wordsPerMinute,
} from './typing-race';

const race = (by: string, round: number, startsAt = 1_000): GameLogEntry => ({
  t: 'race',
  by,
  round,
  startsAt,
  passage: round,
});

describe('typing race replay', () => {
  it('snapshots the lobby into each round and collapses duplicate starts', () => {
    const match = replayTypingRace([
      { t: 'join', by: 'ann' },
      { t: 'join', by: 'bob' },
      race('ann', 0),
      race('bob', 0),
      race('cat', 1),
      { t: 'join', by: 'cat' },
      { t: 'leave', by: 'bob' },
      race('cat', 1, 5_000),
    ]);
    expect(match.lobby).toEqual(['ann', 'cat']);
    expect(match.rounds.map((round) => round.racers)).toEqual([
      ['ann', 'bob'],
      ['ann', 'cat'],
    ]);
    expect(match.rounds[1]).toMatchObject({
      startsAt: 5_000,
      passage: TYPING_PASSAGES[1],
    });
  });
});

describe('typing progress', () => {
  it('counts the correct prefix and any overrun', () => {
    expect(typingProgress('hello', 'helxo')).toEqual({
      correct: 3,
      overrun: 2,
      done: false,
    });
    expect(typingProgress('hello', 'hello').done).toBe(true);
    expect(typingProgress('hello', 'hello!').done).toBe(false);
  });

  it('computes five-character words per minute', () => {
    expect(wordsPerMinute(250, 60_000)).toBe(50);
    expect(wordsPerMinute(100, 0)).toBe(0);
    // Faster than any typist: clamp to what the leaderboard accepts.
    expect(wordsPerMinute(500, 1_000)).toBe(300);
  });

  it('parses progress written by other clients defensively', () => {
    expect(parseRacerProgress('{"typed":12.7,"mistakes":2}')).toEqual({
      typed: 12,
      mistakes: 2,
    });
    expect(parseRacerProgress('{"typed":"12"}')).toBeUndefined();
    expect(parseRacerProgress('not json')).toBeUndefined();
  });
});

describe('race stage and standings', () => {
  const round = {
    round: 0,
    racers: ['ann', 'bob', 'cat'],
    startsAt: 10_000,
    passage: 'abc',
  };

  it('moves from countdown to racing to finished', () => {
    const progress = new Map<string, RacerProgress>();
    expect(raceStage(round, progress, 9_000)).toEqual({
      t: 'countdown',
      msLeft: 1_000,
    });
    expect(raceStage(round, progress, 12_000)).toEqual({
      t: 'racing',
      elapsedMs: 2_000,
    });
    expect(
      raceStage(round, progress, round.startsAt + RACE_TIME_LIMIT_MS)
    ).toEqual({ t: 'finished' });
    const done = new Map(
      round.racers.map((racer) => [
        racer,
        { typed: 3, mistakes: 0, finishedMs: 5_000 },
      ])
    );
    expect(raceStage(round, done, 12_000)).toEqual({ t: 'finished' });
  });

  it('ranks finishers by time and the rest by distance', () => {
    const standings = raceStandings(
      round,
      new Map<string, RacerProgress>([
        ['ann', { typed: 2, mistakes: 0 }],
        ['bob', { typed: 3, mistakes: 1, finishedMs: 9_000 }],
        ['cat', { typed: 3, mistakes: 0, finishedMs: 7_000 }],
      ])
    );
    expect(standings.map((row) => [row.userId, row.place])).toEqual([
      ['cat', 1],
      ['bob', 2],
      ['ann', undefined],
    ]);
  });
});
