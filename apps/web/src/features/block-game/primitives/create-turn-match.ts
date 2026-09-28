import { createMemo } from 'solid-js';
import { type GameStatus, turnMatchStatus } from '../core/status';
import {
  replayTurnMatch,
  seriesWins,
  type TurnRules,
} from '../core/turn-match';
import type { GameRoom } from './create-game-room';

/** Seats, turns and actions for a turn-based room, typed by its rules. */
export function createTurnMatch<State, Move>(
  room: GameRoom,
  rules: TurnRules<State, Move>
) {
  const match = createMemo(() => replayTurnMatch(rules, room.log()));
  const phase = () => match().phase;
  const mySeat = () => {
    const userId = room.userId();
    return userId ? match().seats.indexOf(userId) : -1;
  };
  const seated = () => mySeat() >= 0;
  const isMyTurn = () => {
    const current = phase();
    return current.t === 'playing' && current.turn === mySeat();
  };
  const lobby = () => room.canPlay() && phase().t === 'lobby';
  const over = () => room.canPlay() && phase().t === 'over' && seated();

  return {
    match,
    phase,
    mySeat,
    isMyTurn,
    wins: createMemo(() => seriesWins(match().results)),
    status: (): GameStatus => turnMatchStatus(phase()),
    canJoin: () =>
      lobby() && !seated() && match().seats.length < rules.seats.max,
    canLeave: () => lobby() && seated(),
    canStart: () =>
      lobby() && seated() && match().seats.length >= rules.seats.min,
    canMove: () => room.canPlay() && isMyTurn(),
    canForfeit: () => room.canPlay() && phase().t === 'playing' && seated(),
    canRematch: over,
    join: () => room.append({ t: 'join' }),
    leave: () => room.append({ t: 'leave' }),
    start: () => room.append({ t: 'start' }),
    forfeit: () => room.append({ t: 'forfeit' }),
    rematch: () => room.append({ t: 'rematch' }),
    reopen: () => room.append({ t: 'reopen' }),
    /** Append a move only if it is legal right now. */
    move: (move: Move) => {
      const current = phase();
      if (current.t !== 'playing' || current.turn !== mySeat()) return false;
      if (rules.apply(current.state, move, current.turn) === undefined)
        return false;
      return room.append({ t: 'move', move });
    },
  };
}

export type TurnMatchState<State, Move> = ReturnType<
  typeof createTurnMatch<State, Move>
>;
