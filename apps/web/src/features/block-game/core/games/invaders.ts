import { type Random, randomInt } from '../random';

/** Field size in game units; boards scale it to fit. */
export const INVADERS_FIELD = { width: 100, height: 80 } as const;
const INVADER_ROWS = 5;
export const INVADER_COLS = 9;
export const INVADER_SIZE = { width: 6, height: 4.2 } as const;
export const INVADERS_PLAYER = { y: 74, width: 7, height: 3 } as const;
const H_GAP = 3.2;
const V_GAP = 3;
const START_TOP = 8;
const WAVE_DROP = 3;
const EDGE = 2;
const STEP_X = 1.6;
const STEP_DOWN = 3;
const PLAYER_SPEED = 55;
const SHOT_SPEED = 95;
const BOMB_SPEED = 32;
const START_LIVES = 3;
/** After a hit the player is safe for a moment while the field clears. */
const RECOVERY_MS = 1_200;
/** Points per invader, top row first. */
const ROW_POINTS = [30, 20, 20, 10, 10] as const;

export type Shot = { x: number; y: number };

export type InvadersState = {
  /** Whether each invader is alive, row by row from the top. */
  invaders: boolean[];
  /** Top-left corner of the formation. */
  formationX: number;
  formationY: number;
  direction: 1 | -1;
  /** Milliseconds until the formation steps again. */
  stepIn: number;
  /** Milliseconds until the next bomb drops. */
  bombIn: number;
  playerX: number;
  /** The player has one shot in the air at a time. */
  shot: Shot | undefined;
  bombs: Shot[];
  lives: number;
  score: number;
  wave: number;
  /** Milliseconds of safety left after being hit. */
  recovering: number;
  over: boolean;
};

export type InvadersInput = {
  /** Where a pointer holds the cannon; takes priority over keys. */
  playerX?: number;
  move: number;
  fire: boolean;
};

export function invaderPosition(
  state: Pick<InvadersState, 'formationX' | 'formationY'>,
  index: number
) {
  const row = Math.floor(index / INVADER_COLS);
  const col = index % INVADER_COLS;
  return {
    row,
    x: state.formationX + col * (INVADER_SIZE.width + H_GAP),
    y: state.formationY + row * (INVADER_SIZE.height + V_GAP),
  };
}

const FORMATION_WIDTH =
  INVADER_COLS * INVADER_SIZE.width + (INVADER_COLS - 1) * H_GAP;

function wave(number: number, keep?: Partial<InvadersState>): InvadersState {
  return {
    invaders: Array.from({ length: INVADER_ROWS * INVADER_COLS }, () => true),
    formationX: (INVADERS_FIELD.width - FORMATION_WIDTH) / 2,
    formationY: START_TOP + Math.min(4, number - 1) * WAVE_DROP,
    direction: 1,
    stepIn: 600,
    bombIn: 1_500,
    playerX: INVADERS_FIELD.width / 2,
    shot: undefined,
    bombs: [],
    lives: START_LIVES,
    score: 0,
    wave: number,
    recovering: 0,
    over: false,
    ...keep,
  };
}

export function createInvaders(): InvadersState {
  return wave(1);
}

/** The formation speeds up as it thins out and with every wave. */
function stepInterval(state: InvadersState): number {
  const alive = state.invaders.filter(Boolean).length;
  const share = alive / state.invaders.length;
  const base = 60 + 540 * share;
  return Math.max(40, base * 0.9 ** (state.wave - 1));
}

function bombInterval(state: InvadersState): number {
  return Math.max(350, 1_100 * 0.9 ** (state.wave - 1));
}

function overlaps(
  shot: Shot,
  box: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    shot.x >= box.x &&
    shot.x <= box.x + box.width &&
    shot.y >= box.y &&
    shot.y <= box.y + box.height
  );
}

function stepFormation(state: InvadersState): InvadersState {
  const alive = state.invaders
    .map((isAlive, index) => (isAlive ? invaderPosition(state, index) : null))
    .filter((position) => position !== null);
  const left = Math.min(...alive.map((position) => position.x));
  const right = Math.max(
    ...alive.map((position) => position.x + INVADER_SIZE.width)
  );
  const nextLeft = left + state.direction * STEP_X;
  const nextRight = right + state.direction * STEP_X;
  if (nextLeft < EDGE || nextRight > INVADERS_FIELD.width - EDGE) {
    return {
      ...state,
      formationY: state.formationY + STEP_DOWN,
      direction: state.direction === 1 ? -1 : 1,
    };
  }
  return { ...state, formationX: state.formationX + state.direction * STEP_X };
}

function dropBomb(state: InvadersState, random: Random): InvadersState {
  const columns = Array.from({ length: INVADER_COLS }, (_, col) => col).filter(
    (col) =>
      Array.from({ length: INVADER_ROWS }).some(
        (_, row) => state.invaders[row * INVADER_COLS + col]
      )
  );
  if (columns.length === 0) return state;
  const col = columns[randomInt(random, columns.length)];
  let lowest = 0;
  for (let row = 0; row < INVADER_ROWS; row += 1)
    if (state.invaders[row * INVADER_COLS + col]) lowest = row;
  const position = invaderPosition(state, lowest * INVADER_COLS + col);
  return {
    ...state,
    bombs: [
      ...state.bombs,
      {
        x: position.x + INVADER_SIZE.width / 2,
        y: position.y + INVADER_SIZE.height,
      },
    ],
  };
}

/** Advance the game by `dtMs`. */
export function stepInvaders(
  state: InvadersState,
  input: InvadersInput,
  dtMs: number,
  random: Random
): InvadersState {
  if (state.over) return state;
  const dt = dtMs / 1000;
  const half = INVADERS_PLAYER.width / 2;
  let next: InvadersState = {
    ...state,
    playerX: Math.min(
      INVADERS_FIELD.width - half,
      Math.max(
        half,
        input.playerX ?? state.playerX + input.move * PLAYER_SPEED * dt
      )
    ),
    recovering: Math.max(0, state.recovering - dtMs),
  };

  if (input.fire && !next.shot && next.recovering === 0) {
    next = {
      ...next,
      shot: { x: next.playerX, y: INVADERS_PLAYER.y - 1 },
    };
  }

  // The shot climbs until it hits an invader or leaves the field.
  if (next.shot) {
    const shot = { ...next.shot, y: next.shot.y - SHOT_SPEED * dt };
    const hit = next.invaders.findIndex(
      (alive, index) =>
        alive &&
        overlaps(shot, {
          ...invaderPosition(next, index),
          ...INVADER_SIZE,
        })
    );
    if (hit >= 0) {
      next = {
        ...next,
        shot: undefined,
        invaders: next.invaders.map((alive, index) => alive && index !== hit),
        score: next.score + ROW_POINTS[invaderPosition(next, hit).row],
      };
    } else {
      next = { ...next, shot: shot.y < 0 ? undefined : shot };
    }
  }

  if (next.invaders.every((alive) => !alive)) {
    return wave(next.wave + 1, {
      score: next.score,
      lives: next.lives,
      playerX: next.playerX,
    });
  }

  let stepIn = next.stepIn - dtMs;
  while (stepIn <= 0) {
    next = stepFormation(next);
    stepIn += stepInterval(next);
  }
  next = { ...next, stepIn };

  let bombIn = next.bombIn - dtMs;
  if (bombIn <= 0) {
    next = dropBomb(next, random);
    bombIn = bombInterval(next);
  }
  next = { ...next, bombIn };

  const player = {
    x: next.playerX - half,
    y: INVADERS_PLAYER.y,
    width: INVADERS_PLAYER.width,
    height: INVADERS_PLAYER.height,
  };
  const bombs = next.bombs
    .map((bomb) => ({ ...bomb, y: bomb.y + BOMB_SPEED * dt }))
    .filter((bomb) => bomb.y < INVADERS_FIELD.height);
  if (next.recovering === 0 && bombs.some((bomb) => overlaps(bomb, player))) {
    const lives = next.lives - 1;
    return {
      ...next,
      bombs: [],
      shot: undefined,
      lives,
      recovering: RECOVERY_MS,
      over: lives <= 0,
    };
  }
  next = { ...next, bombs };

  // Invaders reaching the cannon's row have landed.
  const landed = next.invaders.some(
    (alive, index) =>
      alive &&
      invaderPosition(next, index).y + INVADER_SIZE.height >= INVADERS_PLAYER.y
  );
  return landed ? { ...next, over: true } : next;
}
