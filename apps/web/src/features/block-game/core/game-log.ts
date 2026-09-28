import { isFiniteNumber, isIndex, isRecord } from './guards';

/**
 * Every room keeps one append-only log. Loro merges concurrent appends into the
 * same order on every peer, so replaying the log yields the same seats, moves
 * and results everywhere; a move that loses a race simply replays as invalid.
 */
export type GameLogEntry =
  /** Take a seat while the table is open. */
  | { t: 'join'; by: string }
  /** Give up a seat before the round starts. */
  | { t: 'leave'; by: string }
  /** Start a round with the players currently seated. */
  | { t: 'start'; by: string }
  | { t: 'move'; by: string; move: unknown }
  /** Concede the current round. */
  | { t: 'forfeit'; by: string }
  /** Play again with the same seats. */
  | { t: 'rematch'; by: string }
  /** Reopen the table so players can join or leave. */
  | { t: 'reopen'; by: string }
  /** A finished solo run. */
  | { t: 'run'; by: string; score: number; at: number }
  /**
   * Start typing-race `round`, whose countdown ends at `startsAt` (epoch ms).
   * Naming the round makes simultaneous starts collapse into one race.
   */
  | {
      t: 'race';
      by: string;
      round: number;
      startsAt: number;
      passage: number;
    };

const MAX_USER_ID_LENGTH = 256;
const MAX_ROUNDS = 1_000_000;

function isUserId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_USER_ID_LENGTH
  );
}

/**
 * Decode one stored entry. Entries are written by other clients, so anything
 * malformed or from a newer client is skipped instead of trusted.
 */
function parseGameLogEntry(raw: unknown): GameLogEntry | undefined {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(value) || !isUserId(value.by)) return undefined;
  const by = value.by;
  switch (value.t) {
    case 'join':
    case 'leave':
    case 'start':
    case 'forfeit':
    case 'rematch':
    case 'reopen':
      return { t: value.t, by };
    case 'move':
      return 'move' in value ? { t: 'move', by, move: value.move } : undefined;
    case 'run':
      return isFiniteNumber(value.score) && isFiniteNumber(value.at)
        ? { t: 'run', by, score: value.score, at: value.at }
        : undefined;
    case 'race':
      return isFiniteNumber(value.startsAt) &&
        isIndex(value.round, MAX_ROUNDS) &&
        isIndex(value.passage, MAX_ROUNDS)
        ? {
            t: 'race',
            by,
            round: value.round,
            startsAt: value.startsAt,
            passage: value.passage,
          }
        : undefined;
    default:
      return undefined;
  }
}

export function encodeGameLogEntry(entry: GameLogEntry): string {
  return JSON.stringify(entry);
}

export function parseGameLog(raw: readonly unknown[]): GameLogEntry[] {
  const entries: GameLogEntry[] = [];
  for (const item of raw) {
    const entry = parseGameLogEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}
