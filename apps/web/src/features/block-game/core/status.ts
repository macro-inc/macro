import { match } from 'ts-pattern';
import type { RaceStage } from './games/typing-race';
import type { TurnPhase } from './turn-match';

/**
 * Whether a room is waiting for players, being played, or done. Rooms publish
 * it as the document's Status so lists and channel mentions can show it.
 */
export type GameStatus = 'waiting' | 'in_progress' | 'finished';

export function turnMatchStatus<State>(phase: TurnPhase<State>): GameStatus {
  return match(phase.t)
    .returnType<GameStatus>()
    .with('lobby', () => 'waiting')
    .with('playing', () => 'in_progress')
    .with('over', () => 'finished')
    .exhaustive();
}

export function typingRaceStatus(stage: RaceStage | undefined): GameStatus {
  if (!stage) return 'waiting';
  return stage.t === 'finished' ? 'finished' : 'in_progress';
}

/** Solo rooms are in progress while anyone is mid-run. */
export function soloRoomStatus(options: {
  playing: boolean;
  runs: number;
}): GameStatus {
  if (options.playing) return 'in_progress';
  return options.runs > 0 ? 'finished' : 'waiting';
}
