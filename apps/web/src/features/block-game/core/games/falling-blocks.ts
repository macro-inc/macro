import { type Random, randomInt } from '../random';

export const BLOCKS_COLS = 10;
export const BLOCKS_ROWS = 20;

export const PIECE_KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

type Cell = readonly [x: number, y: number];

/** Spawn orientation of each piece inside its rotation box. */
const SHAPES: Record<PieceKind, { size: number; cells: readonly Cell[] }> = {
  I: {
    size: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  O: {
    size: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  T: {
    size: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  S: {
    size: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
  Z: {
    size: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  J: {
    size: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  L: {
    size: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
};

/** Offsets tried in order when a rotation collides, so pieces turn by walls. */
const KICKS: readonly Cell[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
];

/** Points for clearing one to four lines at once, times the level. */
const LINE_POINTS = [0, 100, 300, 500, 800] as const;

export type Piece = { kind: PieceKind; rotation: number; x: number; y: number };

export type FallingBlocksState = {
  /** Settled cells, row by row from the top. */
  board: (PieceKind | null)[];
  piece: Piece;
  /** Upcoming pieces; the first is shown as next. */
  queue: PieceKind[];
  score: number;
  lines: number;
  level: number;
  over: boolean;
};

export function pieceCells(piece: Piece): Cell[] {
  const { size, cells } = SHAPES[piece.kind];
  return cells.map(([cx, cy]) => {
    let x = cx;
    let y = cy;
    for (let turn = 0; turn < ((piece.rotation % 4) + 4) % 4; turn += 1) {
      [x, y] = [size - 1 - y, x];
    }
    return [piece.x + x, piece.y + y] as const;
  });
}

function fits(board: (PieceKind | null)[], piece: Piece): boolean {
  return pieceCells(piece).every(
    ([x, y]) =>
      x >= 0 &&
      x < BLOCKS_COLS &&
      y < BLOCKS_ROWS &&
      (y < 0 || board[y * BLOCKS_COLS + x] === null)
  );
}

/** A shuffled set of all seven pieces, so no piece goes missing for long. */
function bag(random: Random): PieceKind[] {
  const pieces: PieceKind[] = [...PIECE_KINDS];
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const swap = randomInt(random, index + 1);
    [pieces[index], pieces[swap]] = [pieces[swap], pieces[index]];
  }
  return pieces;
}

function spawn(kind: PieceKind): Piece {
  const { size } = SHAPES[kind];
  return {
    kind,
    rotation: 0,
    x: Math.floor((BLOCKS_COLS - size) / 2),
    y: kind === 'I' ? -1 : 0,
  };
}

export function createFallingBlocks(random: Random): FallingBlocksState {
  const [first, ...queue] = [...bag(random), ...bag(random)];
  return {
    board: Array.from({ length: BLOCKS_COLS * BLOCKS_ROWS }, () => null),
    piece: spawn(first),
    queue,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
  };
}

/** Milliseconds between gravity steps; faster every level. */
export function gravityMs(level: number): number {
  return Math.max(80, Math.round(800 * 0.85 ** (level - 1)));
}

function withPiece(state: FallingBlocksState, piece: Piece) {
  return fits(state.board, piece) ? { ...state, piece } : state;
}

export function moveBlocks(
  state: FallingBlocksState,
  dx: number
): FallingBlocksState {
  if (state.over) return state;
  return withPiece(state, { ...state.piece, x: state.piece.x + dx });
}

export function rotateBlocks(
  state: FallingBlocksState,
  direction: 1 | -1
): FallingBlocksState {
  if (state.over || state.piece.kind === 'O') return state;
  const rotation = (state.piece.rotation + direction + 4) % 4;
  for (const [dx, dy] of KICKS) {
    const piece = {
      ...state.piece,
      rotation,
      x: state.piece.x + dx,
      y: state.piece.y + dy,
    };
    if (fits(state.board, piece)) return { ...state, piece };
  }
  return state;
}

/** Settle the piece, clear full lines, and bring in the next piece. */
function lock(state: FallingBlocksState, random: Random): FallingBlocksState {
  const board = [...state.board];
  let toppedOut = false;
  for (const [x, y] of pieceCells(state.piece)) {
    if (y < 0) toppedOut = true;
    else board[y * BLOCKS_COLS + x] = state.piece.kind;
  }
  const rows: (PieceKind | null)[][] = [];
  for (let row = 0; row < BLOCKS_ROWS; row += 1)
    rows.push(board.slice(row * BLOCKS_COLS, (row + 1) * BLOCKS_COLS));
  const kept = rows.filter((row) => row.some((cell) => cell === null));
  const cleared = BLOCKS_ROWS - kept.length;
  const empty = Array.from({ length: cleared }, () =>
    Array.from({ length: BLOCKS_COLS }, (): PieceKind | null => null)
  );
  const settled = [...empty, ...kept].flat();

  const lines = state.lines + cleared;
  const score = state.score + LINE_POINTS[cleared] * state.level;
  const level = 1 + Math.floor(lines / 10);
  const [nextKind, ...rest] = state.queue;
  const queue = rest.length < 7 ? [...rest, ...bag(random)] : rest;
  const piece = spawn(nextKind);
  return {
    board: settled,
    piece,
    queue,
    score,
    lines,
    level,
    over: toppedOut || !fits(settled, piece),
  };
}

/** One gravity step: fall a row, or lock where the piece rests. */
export function tickBlocks(
  state: FallingBlocksState,
  random: Random
): FallingBlocksState {
  if (state.over) return state;
  const lower = { ...state.piece, y: state.piece.y + 1 };
  return fits(state.board, lower)
    ? { ...state, piece: lower }
    : lock(state, random);
}

/** Drop one row faster than gravity, for a point. */
export function softDropBlocks(
  state: FallingBlocksState,
  random: Random
): FallingBlocksState {
  if (state.over) return state;
  const lower = { ...state.piece, y: state.piece.y + 1 };
  return fits(state.board, lower)
    ? { ...state, piece: lower, score: state.score + 1 }
    : lock(state, random);
}

/** Where the piece would land; drawn as a guide. */
export function landingPiece(state: FallingBlocksState): Piece {
  let piece = state.piece;
  while (fits(state.board, { ...piece, y: piece.y + 1 }))
    piece = { ...piece, y: piece.y + 1 };
  return piece;
}

/** Drop straight to the landing spot for two points a row, and lock. */
export function hardDropBlocks(
  state: FallingBlocksState,
  random: Random
): FallingBlocksState {
  if (state.over) return state;
  const landed = landingPiece(state);
  const dropped = landed.y - state.piece.y;
  return lock(
    { ...state, piece: landed, score: state.score + dropped * 2 },
    random
  );
}

/** Cells of a piece in its own box, for the next-piece preview. */
export function previewCells(kind: PieceKind): Cell[] {
  return pieceCells({ kind, rotation: 0, x: 0, y: 0 });
}
