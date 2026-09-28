import { isIndex, isRecord } from '../guards';
import type { TurnRules } from '../turn-match';

/** Nine cells, row-major; each holds the seat that marked it. */
export type TicTacToeState = {
  board: (number | null)[];
  turn: number;
};

export type TicTacToeMove = { cell: number };

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function ticTacToeWinningLine(
  board: readonly (number | null)[]
): readonly number[] | undefined {
  return LINES.find(([a, b, c]) => {
    const mark = board[a];
    return mark !== null && mark === board[b] && mark === board[c];
  });
}

export const ticTacToeRules: TurnRules<TicTacToeState, TicTacToeMove> = {
  seats: { min: 2, max: 2 },
  autoStart: true,
  initial: (_players, round) => ({
    board: Array.from({ length: 9 }, () => null),
    turn: round % 2,
  }),
  parseMove: (value) =>
    isRecord(value) && isIndex(value.cell, 9)
      ? { cell: value.cell }
      : undefined,
  apply: (state, move, seat) => {
    if (state.board[move.cell] !== null) return undefined;
    const board = state.board.slice();
    board[move.cell] = seat;
    return { board, turn: 1 - seat };
  },
  progress: (state) => {
    const line = ticTacToeWinningLine(state.board);
    if (line) return { t: 'over', winners: [state.board[line[0]] as number] };
    if (state.board.every((cell) => cell !== null))
      return { t: 'over', winners: [] };
    return { t: 'turn', seat: state.turn };
  },
};
