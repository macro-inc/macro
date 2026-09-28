import type { Random } from '../random';

/** Field size in game units; boards scale it to fit. */
export const FLAPPY_FIELD = { width: 100, height: 130 } as const;
/** Top of the ground strip. */
export const FLAPPY_GROUND = 122;
export const FLAPPY_BIRD = { x: 28, radius: 3.4 } as const;
export const FLAPPY_PIPE_WIDTH = 14;
export const FLAPPY_GAP = 38;
const GRAVITY = 260;
const FLAP_SPEED = -88;
const PIPE_SPEED = 40;
const PIPE_SPACING = 58;
const FIRST_PIPE_X = 120;
const GAP_MARGIN = 14;

export type Pipe = { x: number; gapY: number; passed: boolean };

export type FlappyState = {
  birdY: number;
  velocity: number;
  pipes: Pipe[];
  score: number;
  /** The bird hovers until the first flap. */
  started: boolean;
  over: boolean;
};

function randomGap(random: Random): number {
  const min = GAP_MARGIN + FLAPPY_GAP / 2;
  const max = FLAPPY_GROUND - GAP_MARGIN - FLAPPY_GAP / 2;
  return min + random() * (max - min);
}

export function createFlappy(random: Random): FlappyState {
  return {
    birdY: FLAPPY_GROUND / 2,
    velocity: 0,
    pipes: Array.from({ length: 3 }, (_, index) => ({
      x: FIRST_PIPE_X + index * PIPE_SPACING,
      gapY: randomGap(random),
      passed: false,
    })),
    score: 0,
    started: false,
    over: false,
  };
}

export function flap(state: FlappyState): FlappyState {
  if (state.over) return state;
  return { ...state, started: true, velocity: FLAP_SPEED };
}

function hitsPipe(birdY: number, pipe: Pipe): boolean {
  const r = FLAPPY_BIRD.radius;
  const withinX =
    FLAPPY_BIRD.x + r > pipe.x &&
    FLAPPY_BIRD.x - r < pipe.x + FLAPPY_PIPE_WIDTH;
  if (!withinX) return false;
  return (
    birdY - r < pipe.gapY - FLAPPY_GAP / 2 ||
    birdY + r > pipe.gapY + FLAPPY_GAP / 2
  );
}

/** Advance the game by `dtMs`: gravity, scrolling pipes, scoring, crashes. */
export function stepFlappy(
  state: FlappyState,
  dtMs: number,
  random: Random
): FlappyState {
  if (state.over || !state.started) return state;
  const dt = dtMs / 1000;
  const velocity = state.velocity + GRAVITY * dt;
  const birdY = Math.max(FLAPPY_BIRD.radius, state.birdY + velocity * dt);
  let score = state.score;
  let pipes = state.pipes.map((pipe) => {
    const moved = { ...pipe, x: pipe.x - PIPE_SPEED * dt };
    if (!moved.passed && moved.x + FLAPPY_PIPE_WIDTH < FLAPPY_BIRD.x) {
      score += 1;
      return { ...moved, passed: true };
    }
    return moved;
  });
  // Recycle pipes that scrolled away as new ones on the right.
  if (pipes[0] && pipes[0].x + FLAPPY_PIPE_WIDTH < 0) {
    const last = pipes[pipes.length - 1];
    pipes = [
      ...pipes.slice(1),
      { x: last.x + PIPE_SPACING, gapY: randomGap(random), passed: false },
    ];
  }
  const crashed =
    birdY + FLAPPY_BIRD.radius >= FLAPPY_GROUND ||
    pipes.some((pipe) => hitsPipe(birdY, pipe));
  return {
    ...state,
    birdY: crashed
      ? Math.min(birdY, FLAPPY_GROUND - FLAPPY_BIRD.radius)
      : birdY,
    velocity,
    pipes,
    score,
    over: crashed,
  };
}
