import { isIndex, isRecord } from '../guards';
import type { TurnRules } from '../turn-match';

export type DotsEdgeKind = 'h' | 'v';

/**
 * A grid of `rows` × `cols` boxes. Horizontal edges are indexed
 * `row * cols + col` for rows 0..=rows; vertical edges `row * (cols + 1) + col`
 * for cols 0..=cols. Every edge and box holds the seat that drew or claimed it.
 */
export type DotsAndBoxesState = {
  rows: number;
  cols: number;
  players: number;
  horizontal: (number | null)[];
  vertical: (number | null)[];
  boxes: (number | null)[];
  turn: number;
  last?: { edge: DotsEdgeKind; index: number };
};

export type DotsAndBoxesMove = { edge: DotsEdgeKind; index: number };

/** Two players get a quick 4×4; larger tables get room to breathe. */
function dotsBoardSize(players: number): number {
  return players <= 2 ? 4 : 5;
}

function horizontalCount(state: Pick<DotsAndBoxesState, 'rows' | 'cols'>) {
  return (state.rows + 1) * state.cols;
}

function verticalCount(state: Pick<DotsAndBoxesState, 'rows' | 'cols'>) {
  return state.rows * (state.cols + 1);
}

function boxClosed(
  state: Pick<DotsAndBoxesState, 'cols' | 'horizontal' | 'vertical'>,
  row: number,
  col: number
): boolean {
  const { cols, horizontal, vertical } = state;
  return (
    horizontal[row * cols + col] !== null &&
    horizontal[(row + 1) * cols + col] !== null &&
    vertical[row * (cols + 1) + col] !== null &&
    vertical[row * (cols + 1) + col + 1] !== null
  );
}

/** Boxes bordering an edge, as [row, col]. */
function adjacentBoxes(
  state: Pick<DotsAndBoxesState, 'rows' | 'cols'>,
  edge: DotsEdgeKind,
  index: number
): [number, number][] {
  const boxes: [number, number][] = [];
  if (edge === 'h') {
    const row = Math.floor(index / state.cols);
    const col = index % state.cols;
    if (row > 0) boxes.push([row - 1, col]);
    if (row < state.rows) boxes.push([row, col]);
  } else {
    const row = Math.floor(index / (state.cols + 1));
    const col = index % (state.cols + 1);
    if (col > 0) boxes.push([row, col - 1]);
    if (col < state.cols) boxes.push([row, col]);
  }
  return boxes;
}

export function dotsScores(state: DotsAndBoxesState): number[] {
  const scores = Array.from({ length: state.players }, () => 0);
  for (const owner of state.boxes) if (owner !== null) scores[owner] += 1;
  return scores;
}

export const dotsAndBoxesRules: TurnRules<DotsAndBoxesState, DotsAndBoxesMove> =
  {
    seats: { min: 2, max: 4 },
    autoStart: false,
    initial: (players, round) => {
      const size = dotsBoardSize(players);
      const shape = { rows: size, cols: size };
      return {
        ...shape,
        players,
        horizontal: Array.from({ length: horizontalCount(shape) }, () => null),
        vertical: Array.from({ length: verticalCount(shape) }, () => null),
        boxes: Array.from({ length: size * size }, () => null),
        turn: round % players,
      };
    },
    parseMove: (value) => {
      if (!isRecord(value)) return undefined;
      if (value.edge !== 'h' && value.edge !== 'v') return undefined;
      // Bounds depend on the board; `apply` rejects out-of-range indices.
      if (!isIndex(value.index, 10_000)) return undefined;
      return { edge: value.edge, index: value.index };
    },
    apply: (state, move, seat) => {
      const edges = move.edge === 'h' ? state.horizontal : state.vertical;
      const count =
        move.edge === 'h' ? horizontalCount(state) : verticalCount(state);
      if (move.index >= count || edges[move.index] !== null) return undefined;
      const next: DotsAndBoxesState = {
        ...state,
        horizontal:
          move.edge === 'h' ? state.horizontal.slice() : state.horizontal,
        vertical: move.edge === 'v' ? state.vertical.slice() : state.vertical,
        boxes: state.boxes.slice(),
        last: move,
      };
      (move.edge === 'h' ? next.horizontal : next.vertical)[move.index] = seat;
      let claimed = false;
      for (const [row, col] of adjacentBoxes(state, move.edge, move.index)) {
        if (boxClosed(next, row, col)) {
          next.boxes[row * state.cols + col] = seat;
          claimed = true;
        }
      }
      // Closing a box earns another turn.
      next.turn = claimed ? seat : (seat + 1) % state.players;
      return next;
    },
    progress: (state) => {
      if (state.boxes.some((owner) => owner === null))
        return { t: 'turn', seat: state.turn };
      const scores = dotsScores(state);
      const best = Math.max(...scores);
      const winners = scores.flatMap((score, seat) =>
        score === best ? [seat] : []
      );
      // Everyone tied is a draw rather than a shared win.
      return {
        t: 'over',
        winners: winners.length === state.players ? [] : winners,
      };
    },
    standings: dotsScores,
  };
