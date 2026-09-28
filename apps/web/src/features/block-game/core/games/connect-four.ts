import { isIndex, isRecord } from '../guards';
import type { TurnRules } from '../turn-match';

export const CONNECT_FOUR_COLUMNS = 7;
export const CONNECT_FOUR_ROWS = 6;

/** Each column lists its discs from the bottom up, by seat. */
export type ConnectFourState = {
  columns: number[][];
  turn: number;
};

export type ConnectFourMove = { column: number };

/** Cells as [column, row], with row 0 at the bottom. */
export type ConnectFourCell = readonly [number, number];

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

export function connectFourDisc(
  state: ConnectFourState,
  column: number,
  row: number
): number | undefined {
  return state.columns[column]?.[row];
}

/** The first four-in-a-row found, or undefined. */
export function connectFourWinningCells(
  state: ConnectFourState
): ConnectFourCell[] | undefined {
  for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
    for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
      const seat = connectFourDisc(state, column, row);
      if (seat === undefined) continue;
      for (const [dc, dr] of DIRECTIONS) {
        const cells: ConnectFourCell[] = [[column, row]];
        for (let step = 1; step < 4; step += 1) {
          const c = column + dc * step;
          const r = row + dr * step;
          if (connectFourDisc(state, c, r) !== seat) break;
          cells.push([c, r]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return undefined;
}

export const connectFourRules: TurnRules<ConnectFourState, ConnectFourMove> = {
  seats: { min: 2, max: 2 },
  autoStart: true,
  initial: (_players, round) => ({
    columns: Array.from({ length: CONNECT_FOUR_COLUMNS }, () => []),
    turn: round % 2,
  }),
  parseMove: (value) =>
    isRecord(value) && isIndex(value.column, CONNECT_FOUR_COLUMNS)
      ? { column: value.column }
      : undefined,
  apply: (state, move, seat) => {
    const column = state.columns[move.column];
    if (column.length >= CONNECT_FOUR_ROWS) return undefined;
    const columns = state.columns.slice();
    columns[move.column] = [...column, seat];
    return { columns, turn: 1 - seat };
  },
  progress: (state) => {
    const cells = connectFourWinningCells(state);
    if (cells) {
      const [column, row] = cells[0];
      return {
        t: 'over',
        winners: [connectFourDisc(state, column, row) as number],
      };
    }
    if (state.columns.every((column) => column.length >= CONNECT_FOUR_ROWS))
      return { t: 'over', winners: [] };
    return { t: 'turn', seat: state.turn };
  },
};
