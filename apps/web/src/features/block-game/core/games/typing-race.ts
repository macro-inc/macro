import type { GameLogEntry } from '../game-log';
import { isFiniteNumber, isRecord } from '../guards';

/** Original passages; plain ASCII so every keyboard can type them. */
export const TYPING_PASSAGES: readonly string[] = [
  'The build is green, the coffee is warm, and the agents are busy. This is the perfect moment to prove your fingers are faster than a compiler.',
  'Good commit messages explain why a change exists. Great ones make the next person smile before they even read the diff.',
  'A small team with clear goals can move mountains, or at least close every open ticket before lunch on a Friday afternoon.',
  'Every bug is a tiny mystery novel. The logs are the clues, the stack trace is the map, and the fix is usually one line long.',
  'Ship early, listen closely, and refine often. Users rarely ask for what they need, but they always show you where it hurts.',
  'The best meetings are short, the best docs are current, and the best code is the code you did not have to write at all.',
  'Caching is easy until it is not. Naming things is hard until you stop trying. Off by one errors happen twice as often as expected.',
  'A calm deploy starts long before the button is pressed. Tests, reviews, and a quick rollback plan turn panic into routine.',
  'Keyboards clatter, cursors blink, and somewhere a progress bar crawls toward one hundred percent. Type like nobody is watching.',
  'Clear writing is clear thinking made visible. If you cannot explain the idea simply, keep working on the idea, not the words.',
  'The quick brown fox jumps over the lazy dog while the eager agent refactors three services and asks for one more review.',
  'Great tools fade into the background. You only notice them when they are missing, like good lighting or a reliable network.',
];

export const RACE_COUNTDOWN_MS = 5_000;
export const RACE_TIME_LIMIT_MS = 180_000;
export const MAX_RACERS = 8;
/** Mistyped characters allowed past the last correct one before input stops. */
export const MAX_TYPING_OVERRUN = 8;

export type RaceRound = {
  round: number;
  racers: string[];
  startsAt: number;
  passage: string;
};

export type TypingRaceMatch = {
  /** Players currently in the lobby; they race in the next round. */
  lobby: string[];
  rounds: RaceRound[];
};

/**
 * Replay a typing-race log. A race entry names the round it starts, so two
 * players starting a race at the same moment produce one round, not two.
 */
export function replayTypingRace(
  log: readonly GameLogEntry[]
): TypingRaceMatch {
  let lobby: string[] = [];
  const rounds: RaceRound[] = [];
  for (const entry of log) {
    switch (entry.t) {
      case 'join':
        if (!lobby.includes(entry.by) && lobby.length < MAX_RACERS)
          lobby = [...lobby, entry.by];
        break;
      case 'leave':
        lobby = lobby.filter((user) => user !== entry.by);
        break;
      case 'race': {
        if (!lobby.includes(entry.by)) break;
        if (entry.round !== rounds.length) break;
        const passage =
          TYPING_PASSAGES[entry.passage % TYPING_PASSAGES.length] ?? '';
        rounds.push({
          round: entry.round,
          racers: lobby,
          startsAt: entry.startsAt,
          passage,
        });
        break;
      }
      default:
        break;
    }
  }
  return { lobby, rounds };
}

/** What a racer reports while typing; `finishedMs` is measured locally. */
export type RacerProgress = {
  typed: number;
  mistakes: number;
  finishedMs?: number;
  wpm?: number;
};

export function parseRacerProgress(raw: unknown): RacerProgress | undefined {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.typed) || !isFiniteNumber(value.mistakes))
    return undefined;
  const progress: RacerProgress = {
    typed: Math.max(0, Math.floor(value.typed)),
    mistakes: Math.max(0, Math.floor(value.mistakes)),
  };
  if (isFiniteNumber(value.finishedMs) && value.finishedMs > 0)
    progress.finishedMs = value.finishedMs;
  if (isFiniteNumber(value.wpm) && value.wpm >= 0) progress.wpm = value.wpm;
  return progress;
}

export function raceProgressKey(round: number, userId: string): string {
  return `${round}:${userId}`;
}

/** How much of `typed` matches the passage, and how far input overran. */
export function typingProgress(
  passage: string,
  typed: string
): { correct: number; overrun: number; done: boolean } {
  let correct = 0;
  while (
    correct < typed.length &&
    correct < passage.length &&
    typed[correct] === passage[correct]
  )
    correct += 1;
  return {
    correct,
    overrun: typed.length - correct,
    done: correct === passage.length && typed.length === passage.length,
  };
}

/** Standard five-characters-per-word WPM. */
/** Well beyond human speed; the leaderboard rejects anything faster. */
const MAX_WORDS_PER_MINUTE = 300;

/** Standard five-character words per minute, capped at the leaderboard bound. */
export function wordsPerMinute(characters: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(
    MAX_WORDS_PER_MINUTE,
    Math.round(characters / 5 / (elapsedMs / 60_000))
  );
}

export type RaceStage =
  | { t: 'countdown'; msLeft: number }
  | { t: 'racing'; elapsedMs: number }
  | { t: 'finished' };

/** A race ends once every racer finishes or the time limit passes. */
export function raceStage(
  race: RaceRound,
  progress: ReadonlyMap<string, RacerProgress>,
  now: number
): RaceStage {
  if (now < race.startsAt)
    return { t: 'countdown', msLeft: race.startsAt - now };
  const everyoneDone = race.racers.every(
    (racer) => progress.get(racer)?.finishedMs !== undefined
  );
  if (everyoneDone || now >= race.startsAt + RACE_TIME_LIMIT_MS)
    return { t: 'finished' };
  return { t: 'racing', elapsedMs: now - race.startsAt };
}

export type RaceStanding = {
  userId: string;
  progress: RacerProgress | undefined;
  /** 1-based finishing place; undefined for racers still typing. */
  place?: number;
};

/** Finishers by time, then everyone else by distance typed. */
export function raceStandings(
  race: RaceRound,
  progress: ReadonlyMap<string, RacerProgress>
): RaceStanding[] {
  const rows = race.racers.map((userId) => ({
    userId,
    progress: progress.get(userId),
  }));
  rows.sort((a, b) => {
    const fa = a.progress?.finishedMs;
    const fb = b.progress?.finishedMs;
    if (fa !== undefined && fb !== undefined) return fa - fb;
    if (fa !== undefined) return -1;
    if (fb !== undefined) return 1;
    return (b.progress?.typed ?? 0) - (a.progress?.typed ?? 0);
  });
  let place = 0;
  return rows.map((row) => {
    if (row.progress?.finishedMs === undefined) return row;
    place += 1;
    return { ...row, place };
  });
}
