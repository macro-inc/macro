import type { Random } from '../random';

/** Field size in game units; boards scale it to fit. */
export const BRICK_FIELD = { width: 100, height: 75 } as const;
const BRICK_ROWS = 6;
const BRICK_COLS = 10;
export const BRICK_PADDLE = { y: 70, width: 16, height: 1.8 } as const;
export const BRICK_BALL_RADIUS = 1.1;
const BRICK_TOP = 8;
const BRICK_SIDE = 3;
const BRICK_GAP = 0.8;
const BRICK_HEIGHT = 3.4;
const START_LIVES = 3;
const START_SPEED = 55;
const LEVEL_SPEEDUP = 1.08;
const MAX_SPEED = 115;
const PADDLE_SPEED = 120;
/** Paddle edges send the ball out at up to this angle from vertical. */
const MAX_BOUNCE = (60 * Math.PI) / 180;
/** Longest distance the ball moves between collision checks. */
const MAX_STEP = 0.5;

export type Ball = { x: number; y: number; vx: number; vy: number };

export type BrickBreakerState = {
  /** Horizontal center of the paddle. */
  paddleX: number;
  ball: Ball;
  /** False while the ball rests on the paddle, before a launch. */
  launched: boolean;
  /** Whether each brick is still standing, row by row from the top. */
  bricks: boolean[];
  lives: number;
  score: number;
  level: number;
  over: boolean;
};

export type BrickBreakerInput = {
  /** Where a pointer holds the paddle; takes priority over keys. */
  paddleX?: number;
  /** Held arrow keys: -1 left, 1 right. */
  move: number;
};

export function brickRect(index: number) {
  const row = Math.floor(index / BRICK_COLS);
  const col = index % BRICK_COLS;
  const width =
    (BRICK_FIELD.width - BRICK_SIDE * 2 - BRICK_GAP * (BRICK_COLS - 1)) /
    BRICK_COLS;
  return {
    row,
    x: BRICK_SIDE + col * (width + BRICK_GAP),
    y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
    width,
    height: BRICK_HEIGHT,
  };
}

/** Top rows are harder to reach and worth more. */
export function brickPoints(row: number): number {
  return (BRICK_ROWS - row) * 10;
}

function restingBall(paddleX: number): Ball {
  return {
    x: paddleX,
    y: BRICK_PADDLE.y - BRICK_BALL_RADIUS - 0.2,
    vx: 0,
    vy: 0,
  };
}

function levelSpeed(level: number): number {
  return Math.min(MAX_SPEED, START_SPEED * LEVEL_SPEEDUP ** (level - 1));
}

export function createBrickBreaker(): BrickBreakerState {
  const paddleX = BRICK_FIELD.width / 2;
  return {
    paddleX,
    ball: restingBall(paddleX),
    launched: false,
    bricks: Array.from({ length: BRICK_ROWS * BRICK_COLS }, () => true),
    lives: START_LIVES,
    score: 0,
    level: 1,
    over: false,
  };
}

/** Send a resting ball up at a slight random angle. */
export function launchBall(
  state: BrickBreakerState,
  random: Random
): BrickBreakerState {
  if (state.launched || state.over) return state;
  const angle = (random() - 0.5) * (Math.PI / 4.5);
  const speed = levelSpeed(state.level);
  return {
    ...state,
    launched: true,
    ball: {
      ...state.ball,
      vx: speed * Math.sin(angle),
      vy: -speed * Math.cos(angle),
    },
  };
}

function clampPaddle(x: number): number {
  const half = BRICK_PADDLE.width / 2;
  return Math.min(BRICK_FIELD.width - half, Math.max(half, x));
}

/** Push the ball out of the brick it overlaps and turn it around. */
function hitBrick(ball: Ball, index: number): Ball | undefined {
  const brick = brickRect(index);
  const r = BRICK_BALL_RADIUS;
  const overlapLeft = ball.x + r - brick.x;
  const overlapRight = brick.x + brick.width - (ball.x - r);
  const overlapTop = ball.y + r - brick.y;
  const overlapBottom = brick.y + brick.height - (ball.y - r);
  if (
    overlapLeft <= 0 ||
    overlapRight <= 0 ||
    overlapTop <= 0 ||
    overlapBottom <= 0
  )
    return undefined;
  const horizontal = Math.min(overlapLeft, overlapRight);
  const vertical = Math.min(overlapTop, overlapBottom);
  if (horizontal < vertical) {
    const fromLeft = overlapLeft < overlapRight;
    return {
      ...ball,
      x: fromLeft ? brick.x - r : brick.x + brick.width + r,
      vx: fromLeft ? -Math.abs(ball.vx) : Math.abs(ball.vx),
    };
  }
  const fromTop = overlapTop < overlapBottom;
  return {
    ...ball,
    y: fromTop ? brick.y - r : brick.y + brick.height + r,
    vy: fromTop ? -Math.abs(ball.vy) : Math.abs(ball.vy),
  };
}

function bounceOffPaddle(ball: Ball, paddleX: number): Ball {
  const offset = Math.max(
    -1,
    Math.min(1, (ball.x - paddleX) / (BRICK_PADDLE.width / 2))
  );
  const angle = offset * MAX_BOUNCE;
  const speed = Math.hypot(ball.vx, ball.vy);
  return {
    x: ball.x,
    y: BRICK_PADDLE.y - BRICK_BALL_RADIUS,
    vx: speed * Math.sin(angle),
    vy: -speed * Math.cos(angle),
  };
}

/** Advance the game by `dtMs`: move the paddle, then the ball through its collisions. */
export function stepBrickBreaker(
  state: BrickBreakerState,
  input: BrickBreakerInput,
  dtMs: number
): BrickBreakerState {
  if (state.over) return state;
  const dt = dtMs / 1000;
  const paddleX = clampPaddle(
    input.paddleX ?? state.paddleX + input.move * PADDLE_SPEED * dt
  );
  if (!state.launched) return { ...state, paddleX, ball: restingBall(paddleX) };

  let ball = state.ball;
  let bricks = state.bricks;
  let score = state.score;
  const r = BRICK_BALL_RADIUS;
  const speed = Math.hypot(ball.vx, ball.vy);
  const steps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP));
  const h = dt / steps;
  for (let step = 0; step < steps; step += 1) {
    ball = { ...ball, x: ball.x + ball.vx * h, y: ball.y + ball.vy * h };
    if (ball.x - r < 0) ball = { ...ball, x: r, vx: Math.abs(ball.vx) };
    if (ball.x + r > BRICK_FIELD.width)
      ball = { ...ball, x: BRICK_FIELD.width - r, vx: -Math.abs(ball.vx) };
    if (ball.y - r < 0) ball = { ...ball, y: r, vy: Math.abs(ball.vy) };

    const paddleTop = BRICK_PADDLE.y;
    if (
      ball.vy > 0 &&
      ball.y + r >= paddleTop &&
      ball.y - r <= paddleTop + BRICK_PADDLE.height &&
      Math.abs(ball.x - paddleX) <= BRICK_PADDLE.width / 2 + r
    ) {
      ball = bounceOffPaddle(ball, paddleX);
    }

    const index = bricks.findIndex(
      (alive, candidate) => alive && hitBrick(ball, candidate) !== undefined
    );
    if (index >= 0) {
      ball = hitBrick(ball, index) ?? ball;
      bricks = bricks.map((alive, candidate) => alive && candidate !== index);
      score += brickPoints(brickRect(index).row);
    }

    if (ball.y - r > BRICK_FIELD.height) {
      const lives = state.lives - 1;
      return {
        ...state,
        paddleX,
        bricks,
        score,
        lives,
        over: lives <= 0,
        launched: false,
        ball: restingBall(paddleX),
      };
    }
  }

  if (bricks.every((alive) => !alive)) {
    const next = createBrickBreaker();
    return {
      ...next,
      paddleX,
      ball: restingBall(paddleX),
      lives: state.lives,
      score,
      level: state.level + 1,
    };
  }
  return { ...state, paddleX, ball, bricks, score };
}
