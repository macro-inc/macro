import { type Random, randomInt } from '../random';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type Point = { x: number; y: number };

export type SnakeState = {
  size: number;
  /** Head first. */
  body: Point[];
  direction: Direction;
  /** Turns pressed faster than the tick, applied one per step. */
  queued: Direction[];
  apple: Point | undefined;
  apples: number;
  score: number;
  over: boolean;
};

const SNAKE_BOARD_SIZE = 20;
const SNAKE_POINTS_PER_APPLE = 10;
const MAX_QUEUED_TURNS = 2;

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Milliseconds per step: brisk at first, faster with every apple. */
export function snakeStepMs(apples: number): number {
  return Math.max(65, 140 - apples * 3);
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function placeApple(
  size: number,
  body: readonly Point[],
  random: Random
): Point | undefined {
  const occupied = new Set(body.map((point) => point.y * size + point.x));
  const free: number[] = [];
  for (let cell = 0; cell < size * size; cell += 1)
    if (!occupied.has(cell)) free.push(cell);
  if (free.length === 0) return undefined;
  const cell = free[randomInt(random, free.length)];
  return { x: cell % size, y: Math.floor(cell / size) };
}

export function createSnake(
  random: Random,
  size = SNAKE_BOARD_SIZE
): SnakeState {
  const y = Math.floor(size / 2);
  const x = Math.floor(size / 4) + 2;
  const body = [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
  return {
    size,
    body,
    direction: 'right',
    queued: [],
    apple: placeApple(size, body, random),
    apples: 0,
    score: 0,
    over: false,
  };
}

/** Queue a turn; reversing into the neck or repeating a heading is ignored. */
export function turnSnake(state: SnakeState, direction: Direction): SnakeState {
  if (state.over || state.queued.length >= MAX_QUEUED_TURNS) return state;
  const heading = state.queued.at(-1) ?? state.direction;
  if (direction === heading || direction === OPPOSITE[heading]) return state;
  return { ...state, queued: [...state.queued, direction] };
}

export function stepSnake(state: SnakeState, random: Random): SnakeState {
  if (state.over) return state;
  const [direction = state.direction, ...queued] = state.queued;
  const head = state.body[0];
  const delta = DELTA[direction];
  const next = { x: head.x + delta.x, y: head.y + delta.y };
  const eats = state.apple !== undefined && samePoint(next, state.apple);
  // The tail moves out of the way this step unless the snake grows.
  const obstacles = eats ? state.body : state.body.slice(0, -1);
  const outside =
    next.x < 0 || next.y < 0 || next.x >= state.size || next.y >= state.size;
  if (outside || obstacles.some((point) => samePoint(point, next))) {
    return { ...state, direction, queued, over: true };
  }
  const body = [next, ...obstacles];
  if (!eats) return { ...state, body, direction, queued };
  const apple = placeApple(state.size, body, random);
  return {
    ...state,
    body,
    direction,
    queued,
    apple,
    apples: state.apples + 1,
    score: state.score + SNAKE_POINTS_PER_APPLE,
    // Filling the whole board ends the run as a perfect game.
    over: apple === undefined,
  };
}
