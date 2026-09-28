import { describe, expect, it } from 'vitest';
import { createRandom } from '../random';
import {
  chordCell,
  createMinesweeper,
  type MinesweeperState,
  neighbors,
  revealCell,
  toggleFlag,
} from './minesweeper';
import {
  createSnake,
  type SnakeState,
  snakeStepMs,
  stepSnake,
  turnSnake,
} from './snake';
import {
  canMove,
  slideTwentyFortyEight,
  type Tile,
  type TwentyFortyEightState,
} from './twenty-forty-eight';

const firstCell = () => 0;

describe('snake', () => {
  const base = (overrides: Partial<SnakeState>): SnakeState => ({
    size: 10,
    body: [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ],
    direction: 'right',
    queued: [],
    apple: { x: 9, y: 9 },
    apples: 0,
    score: 0,
    over: false,
    ...overrides,
  });

  it('starts in the middle heading right with an apple off the body', () => {
    const snake = createSnake(createRandom(7));
    expect(snake.body).toHaveLength(3);
    expect(snake.direction).toBe('right');
    expect(snake.apple).toBeDefined();
    expect(
      snake.body.some((p) => p.x === snake.apple?.x && p.y === snake.apple?.y)
    ).toBe(false);
  });

  it('moves one cell per step without growing', () => {
    const next = stepSnake(base({}), firstCell);
    expect(next.body).toEqual([
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ]);
  });

  it('ignores reversals and repeated headings but queues real turns', () => {
    let snake = turnSnake(base({}), 'left');
    snake = turnSnake(snake, 'right');
    expect(snake.queued).toEqual([]);
    snake = turnSnake(snake, 'up');
    snake = turnSnake(snake, 'left');
    snake = turnSnake(snake, 'down');
    expect(snake.queued).toEqual(['up', 'left']);
    snake = stepSnake(snake, firstCell);
    expect(snake.direction).toBe('up');
    expect(snake.body[0]).toEqual({ x: 3, y: 2 });
  });

  it('grows, scores and speeds up after eating', () => {
    const next = stepSnake(base({ apple: { x: 4, y: 3 } }), firstCell);
    expect(next.body).toHaveLength(4);
    expect(next.score).toBe(10);
    expect(next.apples).toBe(1);
    expect(next.apple).toEqual({ x: 0, y: 0 });
    expect(snakeStepMs(1)).toBeLessThan(snakeStepMs(0));
  });

  it('dies at the wall and on its own body', () => {
    const wall = stepSnake(
      base({ body: [{ x: 9, y: 0 }], direction: 'right' }),
      firstCell
    );
    expect(wall.over).toBe(true);
    const coiled = base({
      body: [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 2 },
        { x: 3, y: 1 },
      ],
      direction: 'up',
      queued: ['right'],
    });
    expect(stepSnake(coiled, firstCell).over).toBe(true);
  });

  it('may follow its own tail into the cell it vacates', () => {
    const loop = base({
      body: [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      direction: 'right',
      queued: ['up'],
    });
    const next = stepSnake(loop, firstCell);
    expect(next.over).toBe(false);
    expect(next.body[0]).toEqual({ x: 1, y: 0 });
  });
});

describe('2048', () => {
  const board = (rows: number[][]): TwentyFortyEightState => {
    const tiles: Tile[] = [];
    rows.forEach((values, row) =>
      values.forEach((value, col) => {
        if (value) tiles.push({ id: tiles.length + 1, value, row, col });
      })
    );
    return {
      size: 4,
      tiles,
      score: 0,
      nextId: tiles.length + 1,
      won: false,
      over: false,
    };
  };
  const row = (state: TwentyFortyEightState, index: number) =>
    Array.from(
      { length: 4 },
      (_, col) =>
        state.tiles.find((t) => t.row === index && t.col === col)?.value ?? 0
    );
  // Spawns land in the last free cell, clear of the rows under test.
  const spawnLast = () => 0.95;

  it('merges each pair once, toward the slide', () => {
    const { state, moved } = slideTwentyFortyEight(
      board([
        [2, 2, 2, 2],
        [2, 2, 4, 0],
        [4, 0, 4, 2],
        [0, 0, 0, 0],
      ]),
      'left',
      spawnLast
    );
    expect(moved).toBe(true);
    expect(row(state, 0)).toEqual([4, 4, 0, 0]);
    expect(row(state, 1)).toEqual([4, 4, 0, 0]);
    expect(row(state, 2)).toEqual([8, 2, 0, 0]);
    expect(state.score).toBe(4 + 4 + 4 + 8);
  });

  it('slides right and down from the far edge', () => {
    const right = slideTwentyFortyEight(
      board([
        [2, 0, 2, 4],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'right',
      spawnLast
    ).state;
    expect(row(right, 0).slice(2)).toEqual([4, 4]);
    const down = slideTwentyFortyEight(
      board([
        [2, 0, 0, 0],
        [2, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'down',
      spawnLast
    ).state;
    expect(down.tiles.find((t) => t.merged)).toMatchObject({
      value: 4,
      row: 3,
      col: 0,
    });
  });

  it('spawns exactly one tile after a move and none after a no-op', () => {
    const start = board([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const blocked = slideTwentyFortyEight(start, 'left', spawnLast);
    expect(blocked.moved).toBe(false);
    expect(blocked.state).toBe(start);
    const moved = slideTwentyFortyEight(start, 'right', spawnLast);
    expect(moved.state.tiles).toHaveLength(2);
    expect(moved.state.tiles.filter((t) => t.spawned)).toHaveLength(1);
  });

  it('detects a locked board', () => {
    expect(
      canMove(
        board([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 2],
        ])
      )
    ).toBe(false);
    expect(
      canMove(
        board([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 4],
        ])
      )
    ).toBe(true);
  });
});

describe('minesweeper', () => {
  /** A board with mines at fixed positions, as if the first click happened. */
  const withMines = (
    rows: number,
    cols: number,
    mines: number[]
  ): MinesweeperState => {
    const state = createMinesweeper(rows, cols, mines.length);
    const set = new Set(mines);
    return {
      ...state,
      status: 'playing',
      cells: state.cells.map((cell, index) => ({
        ...cell,
        mine: set.has(index),
        adjacent: neighbors(state, index).filter((n) => set.has(n)).length,
      })),
    };
  };

  it('keeps the first click and its neighbors clear of mines', () => {
    const state = revealCell(createMinesweeper(), 70, createRandom(3));
    const safe = [70, ...neighbors(state, 70)];
    expect(safe.every((index) => !state.cells[index].mine)).toBe(true);
    expect(state.cells.filter((cell) => cell.mine)).toHaveLength(24);
    expect(state.cells[70]).toMatchObject({ revealed: true, adjacent: 0 });
    expect(state.status).toBe('playing');
  });

  it('flood-opens empty regions and wins when only mines remain', () => {
    const state = revealCell(withMines(3, 3, [8]), 0, firstCell);
    expect(state.status).toBe('won');
    expect(state.cells[8].flagged).toBe(true);
  });

  it('loses on a mine and reveals the rest', () => {
    const state = revealCell(withMines(3, 3, [4, 8]), 8, firstCell);
    expect(state.status).toBe('lost');
    expect(state.exploded).toBe(8);
    expect(state.cells[4].revealed).toBe(true);
  });

  it('does not reveal flagged cells', () => {
    const flagged = toggleFlag(withMines(3, 3, [8]), 0);
    expect(revealCell(flagged, 0, firstCell)).toBe(flagged);
  });

  it('chords around a satisfied number', () => {
    let state = revealCell(withMines(1, 3, [2]), 1, firstCell);
    expect(state.cells[0].revealed).toBe(false);
    state = toggleFlag(state, 2);
    state = chordCell(state, 1);
    expect(state.status).toBe('won');
  });

  it('chording with a wrong flag detonates the mine', () => {
    let state = revealCell(withMines(1, 3, [2]), 1, firstCell);
    state = toggleFlag(state, 0);
    expect(chordCell(state, 1).status).toBe('lost');
  });
});
