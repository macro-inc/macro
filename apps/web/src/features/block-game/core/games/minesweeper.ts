import { type Random, randomInt } from '../random';

export type MineCell = {
  mine: boolean;
  /** Neighboring mines, meaningful once mines are placed. */
  adjacent: number;
  revealed: boolean;
  flagged: boolean;
};

export type MinesweeperStatus = 'ready' | 'playing' | 'won' | 'lost';

export type MinesweeperState = {
  rows: number;
  cols: number;
  mines: number;
  cells: MineCell[];
  status: MinesweeperStatus;
  /** The mine that ended the game. */
  exploded?: number;
};

const MINESWEEPER_ROWS = 12;
const MINESWEEPER_COLS = 12;
const MINESWEEPER_MINES = 24;

export function createMinesweeper(
  rows = MINESWEEPER_ROWS,
  cols = MINESWEEPER_COLS,
  mines = MINESWEEPER_MINES
): MinesweeperState {
  return {
    rows,
    cols,
    mines,
    cells: Array.from({ length: rows * cols }, () => ({
      mine: false,
      adjacent: 0,
      revealed: false,
      flagged: false,
    })),
    status: 'ready',
  };
}

export function neighbors(
  state: Pick<MinesweeperState, 'rows' | 'cols'>,
  index: number
): number[] {
  const row = Math.floor(index / state.cols);
  const col = index % state.cols;
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && c >= 0 && r < state.rows && c < state.cols)
        result.push(r * state.cols + c);
    }
  }
  return result;
}

/** Place mines away from the first click so it always opens an area. */
function layMines(
  state: MinesweeperState,
  firstClick: number,
  random: Random
): MineCell[] {
  const safe = new Set([firstClick, ...neighbors(state, firstClick)]);
  const candidates: number[] = [];
  for (let index = 0; index < state.cells.length; index += 1)
    if (!safe.has(index)) candidates.push(index);
  const mines = new Set<number>();
  const count = Math.min(state.mines, candidates.length);
  while (mines.size < count) {
    mines.add(candidates[randomInt(random, candidates.length)]);
  }
  return state.cells.map((cell, index) => ({
    ...cell,
    mine: mines.has(index),
    adjacent: neighbors(state, index).filter((n) => mines.has(n)).length,
  }));
}

function settle(state: MinesweeperState): MinesweeperState {
  const hidden = state.cells.filter((cell) => !cell.revealed).length;
  if (hidden !== state.mines) return state;
  // Every safe cell is open: flag the remaining mines for the victory board.
  return {
    ...state,
    status: 'won',
    cells: state.cells.map((cell) =>
      cell.mine ? { ...cell, flagged: true } : cell
    ),
  };
}

function openCells(
  state: MinesweeperState,
  starts: readonly number[]
): MinesweeperState {
  const cells = state.cells.slice();
  const queue = [...starts];
  let exploded: number | undefined;
  while (queue.length > 0) {
    const index = queue.pop() as number;
    const cell = cells[index];
    if (cell.revealed || cell.flagged) continue;
    cells[index] = { ...cell, revealed: true };
    if (cell.mine) {
      exploded ??= index;
      continue;
    }
    if (cell.adjacent === 0) queue.push(...neighbors(state, index));
  }
  if (exploded !== undefined) {
    return {
      ...state,
      status: 'lost',
      exploded,
      cells: cells.map((cell) =>
        cell.mine && !cell.flagged ? { ...cell, revealed: true } : cell
      ),
    };
  }
  return settle({ ...state, cells });
}

export function revealCell(
  state: MinesweeperState,
  index: number,
  random: Random
): MinesweeperState {
  if (state.status === 'won' || state.status === 'lost') return state;
  const cell = state.cells[index];
  if (!cell || cell.revealed || cell.flagged) return state;
  const armed =
    state.status === 'ready'
      ? {
          ...state,
          status: 'playing' as const,
          cells: layMines(state, index, random),
        }
      : state;
  return openCells(armed, [index]);
}

export function toggleFlag(
  state: MinesweeperState,
  index: number
): MinesweeperState {
  if (state.status !== 'playing' && state.status !== 'ready') return state;
  const cell = state.cells[index];
  if (!cell || cell.revealed) return state;
  const cells = state.cells.slice();
  cells[index] = { ...cell, flagged: !cell.flagged };
  return { ...state, cells };
}

/**
 * Clicking a revealed number whose flags are all placed opens every other
 * neighbor, as in the classic game.
 */
export function chordCell(
  state: MinesweeperState,
  index: number
): MinesweeperState {
  if (state.status !== 'playing') return state;
  const cell = state.cells[index];
  if (!cell?.revealed || cell.adjacent === 0) return state;
  const around = neighbors(state, index);
  const flags = around.filter((n) => state.cells[n].flagged).length;
  if (flags !== cell.adjacent) return state;
  return openCells(
    state,
    around.filter((n) => !state.cells[n].revealed && !state.cells[n].flagged)
  );
}

export function flagsRemaining(state: MinesweeperState): number {
  return state.mines - state.cells.filter((cell) => cell.flagged).length;
}
