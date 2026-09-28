import { type PongCourtSnapshot, parseCourtSnapshot } from './games/pong';
import { isFiniteNumber, isRecord } from './guards';

/** What a peer is doing in the room, shared as ephemeral presence. */
export type GamePresence = {
  activity: 'playing' | 'watching';
  /** A solo player's live score, shown to spectators. */
  score?: number;
  /** A Pong player's paddle position. */
  paddle?: number;
  /** The Pong court as the player running the ball sees it. */
  court?: PongCourtSnapshot;
};

/** Decode another client's presence; unknown or malformed fields are dropped. */
export function parseGamePresence(value: unknown): GamePresence {
  if (!isRecord(value)) return { activity: 'watching' };
  const presence: GamePresence = {
    activity: value.activity === 'playing' ? 'playing' : 'watching',
  };
  if (isFiniteNumber(value.score)) presence.score = value.score;
  if (isFiniteNumber(value.paddle)) presence.paddle = value.paddle;
  const court = parseCourtSnapshot(value.court);
  if (court) presence.court = court;
  return presence;
}
