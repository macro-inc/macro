import { type Random, randomInt } from '../random';
import type { Direction } from './snake';

export type Tile = {
  /** Stable across moves so the board can animate a tile sliding. */
  id: number;
  value: number;
  row: number;
  col: number;
  /** Created by a merge on the latest move. */
  merged?: boolean;
  /** Spawned on the latest move. */
  spawned?: boolean;
};

export type TwentyFortyEightState = {
  size: number;
  tiles: Tile[];
  score: number;
  nextId: number;
  /** Reached 2048 at least once; play may continue. */
  won: boolean;
  over: boolean;
};

const TWENTY_FORTY_EIGHT_SIZE = 4;
export const TWENTY_FORTY_EIGHT_GOAL = 2048;

function spawnTile(
  state: TwentyFortyEightState,
  random: Random
): TwentyFortyEightState {
  const occupied = new Set(
    state.tiles.map((tile) => tile.row * state.size + tile.col)
  );
  const free: number[] = [];
  for (let cell = 0; cell < state.size * state.size; cell += 1)
    if (!occupied.has(cell)) free.push(cell);
  if (free.length === 0) return state;
  const cell = free[randomInt(random, free.length)];
  const tile: Tile = {
    id: state.nextId,
    value: random() < 0.9 ? 2 : 4,
    row: Math.floor(cell / state.size),
    col: cell % state.size,
    spawned: true,
  };
  return { ...state, tiles: [...state.tiles, tile], nextId: state.nextId + 1 };
}

export function createTwentyFortyEight(
  random: Random,
  size = TWENTY_FORTY_EIGHT_SIZE
): TwentyFortyEightState {
  const empty: TwentyFortyEightState = {
    size,
    tiles: [],
    score: 0,
    nextId: 1,
    won: false,
    over: false,
  };
  return spawnTile(spawnTile(empty, random), random);
}

/** Whether any slide would change the board. */
export function canMove(state: TwentyFortyEightState): boolean {
  if (state.tiles.length < state.size * state.size) return true;
  const grid = new Map(
    state.tiles.map((tile) => [tile.row * state.size + tile.col, tile.value])
  );
  for (let row = 0; row < state.size; row += 1) {
    for (let col = 0; col < state.size; col += 1) {
      const value = grid.get(row * state.size + col);
      if (
        col + 1 < state.size &&
        grid.get(row * state.size + col + 1) === value
      )
        return true;
      if (
        row + 1 < state.size &&
        grid.get((row + 1) * state.size + col) === value
      )
        return true;
    }
  }
  return false;
}

/**
 * Slide every tile toward `direction`. Each tile merges at most once per
 * move, and a new tile spawns only when something moved.
 */
export function slideTwentyFortyEight(
  state: TwentyFortyEightState,
  direction: Direction,
  random: Random
): { state: TwentyFortyEightState; moved: boolean } {
  if (state.over) return { state, moved: false };
  const { size } = state;
  const vertical = direction === 'up' || direction === 'down';
  const towardStart = direction === 'up' || direction === 'left';
  const tiles: Tile[] = [];
  let score = state.score;
  let moved = false;

  for (let line = 0; line < size; line += 1) {
    const inLine = state.tiles
      .filter((tile) => (vertical ? tile.col : tile.row) === line)
      .sort((a, b) => {
        const pa = vertical ? a.row : a.col;
        const pb = vertical ? b.row : b.col;
        return towardStart ? pa - pb : pb - pa;
      });
    let target = 0;
    let previous: Tile | undefined;
    for (const tile of inLine) {
      if (previous && !previous.merged && previous.value === tile.value) {
        // The leading tile keeps its identity and absorbs this one.
        previous.value *= 2;
        previous.merged = true;
        score += previous.value;
        moved = true;
        continue;
      }
      const position = towardStart ? target : size - 1 - target;
      const next: Tile = {
        id: tile.id,
        value: tile.value,
        row: vertical ? position : line,
        col: vertical ? line : position,
      };
      if (next.row !== tile.row || next.col !== tile.col) moved = true;
      tiles.push(next);
      previous = next;
      target += 1;
    }
  }

  if (!moved) return { state, moved: false };
  let next: TwentyFortyEightState = { ...state, tiles, score };
  next = spawnTile(next, random);
  return {
    state: {
      ...next,
      won:
        state.won ||
        next.tiles.some((tile) => tile.value >= TWENTY_FORTY_EIGHT_GOAL),
      over: !canMove(next),
    },
    moved: true,
  };
}

export function highestTile(state: TwentyFortyEightState): number {
  return state.tiles.reduce((best, tile) => Math.max(best, tile.value), 0);
}
