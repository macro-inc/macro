import { isFiniteNumber, isRecord } from '../guards';
import type { Random } from '../random';
import type { TurnRules } from '../turn-match';

/** Court size in game units; boards scale it to fit. */
export const PONG_COURT = { width: 100, height: 60 } as const;
export const PONG_POINTS_TO_WIN = 7;
export const PONG_PADDLE = { height: 12, width: 1.6, inset: 4 } as const;
export const PONG_BALL_RADIUS = 1.1;
/** How fast a paddle moves while an arrow key is held, in units per second. */
export const PONG_PADDLE_SPEED = 80;
const SERVE_SPEED = 50;
const MAX_SPEED = 115;
const SPEEDUP = 1.07;
/** Paddle edges send the ball out at up to this angle from horizontal. */
const MAX_ANGLE = (55 * Math.PI) / 180;
/** Even a dead-center return climbs a little, so rallies cannot stall. */
const MIN_ANGLE = (8 * Math.PI) / 180;
const MAX_STEP = 0.5;
/** The computer tracks the ball a little slower than a person can. */
const COMPUTER_SPEED = 52;

export type PongBall = { x: number; y: number; vx: number; vy: number };
export type PongSeat = 0 | 1;
export type PongPaddles = readonly [number, number];

export function clampPaddle(y: number): number {
  const half = PONG_PADDLE.height / 2;
  return Math.min(PONG_COURT.height - half, Math.max(half, y));
}

/** The x of the face each paddle returns the ball from. */
export function paddleFace(seat: PongSeat): number {
  return seat === 0 ? PONG_PADDLE.inset : PONG_COURT.width - PONG_PADDLE.inset;
}

export function centeredPaddles(): [number, number] {
  return [PONG_COURT.height / 2, PONG_COURT.height / 2];
}

/** A new ball from the center, heading for `toward` at a gentle random angle. */
export function serveBall(toward: PongSeat, random: Random): PongBall {
  const angle = (random() - 0.5) * (Math.PI / 3);
  const direction = toward === 0 ? -1 : 1;
  return {
    x: PONG_COURT.width / 2,
    y: PONG_COURT.height / 2,
    vx: direction * SERVE_SPEED * Math.cos(angle),
    vy: SERVE_SPEED * Math.sin(angle),
  };
}

function bounceWalls(ball: PongBall): PongBall {
  const r = PONG_BALL_RADIUS;
  if (ball.y - r < 0) return { ...ball, y: r, vy: Math.abs(ball.vy) };
  if (ball.y + r > PONG_COURT.height)
    return { ...ball, y: PONG_COURT.height - r, vy: -Math.abs(ball.vy) };
  return ball;
}

function returnBall(ball: PongBall, paddleY: number, seat: PongSeat): PongBall {
  const reach = PONG_PADDLE.height / 2 + PONG_BALL_RADIUS;
  const offset = Math.max(-1, Math.min(1, (ball.y - paddleY) / reach));
  const raw = offset * MAX_ANGLE;
  const angle =
    Math.abs(raw) >= MIN_ANGLE ? raw : (raw < 0 ? -1 : 1) * MIN_ANGLE;
  const speed = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * SPEEDUP);
  const direction = seat === 0 ? 1 : -1;
  return {
    x: paddleFace(seat) + direction * PONG_BALL_RADIUS,
    y: ball.y,
    vx: direction * speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
  };
}

function touchesPaddle(ball: PongBall, paddleY: number, seat: PongSeat) {
  const face = paddleFace(seat);
  const r = PONG_BALL_RADIUS;
  const heading = seat === 0 ? ball.vx < 0 : ball.vx > 0;
  const atFace =
    seat === 0
      ? ball.x - r <= face && ball.x + r >= face - PONG_PADDLE.width
      : ball.x + r >= face && ball.x - r <= face + PONG_PADDLE.width;
  return (
    heading &&
    atFace &&
    Math.abs(ball.y - paddleY) <= PONG_PADDLE.height / 2 + r
  );
}

/**
 * Advance the ball by `dtSec`. Returns the seat that scored when the ball
 * leaves the court, and the seat whose paddle returned it.
 */
export function stepPongBall(
  ball: PongBall,
  paddles: PongPaddles,
  dtSec: number
): { ball: PongBall; scorer?: PongSeat; returnedBy?: PongSeat } {
  const speed = Math.hypot(ball.vx, ball.vy);
  const steps = Math.max(1, Math.ceil((speed * dtSec) / MAX_STEP));
  const h = dtSec / steps;
  let next = ball;
  let returnedBy: PongSeat | undefined;
  for (let step = 0; step < steps; step += 1) {
    next = bounceWalls({
      ...next,
      x: next.x + next.vx * h,
      y: next.y + next.vy * h,
    });
    for (const seat of [0, 1] as const) {
      if (touchesPaddle(next, paddles[seat], seat)) {
        next = returnBall(next, paddles[seat], seat);
        returnedBy = seat;
      }
    }
    if (next.x + PONG_BALL_RADIUS < 0) return { ball: next, scorer: 1 };
    if (next.x - PONG_BALL_RADIUS > PONG_COURT.width)
      return { ball: next, scorer: 0 };
  }
  return { ball: next, returnedBy };
}

/**
 * Where a ball seen `dtSec` ago is now, bouncing off the walls but not the
 * paddles. Renders the host's ball between its updates.
 */
export function extrapolateBall(ball: PongBall, dtSec: number): PongBall {
  const r = PONG_BALL_RADIUS;
  // Unfold the walls into a line, then fold the travelled distance back.
  const span = PONG_COURT.height - r * 2;
  const period = span * 2;
  const travelled = ball.y - r + ball.vy * dtSec;
  const offset = ((travelled % period) + period) % period;
  const reflected = offset > span;
  return {
    x: Math.max(-r, Math.min(PONG_COURT.width + r, ball.x + ball.vx * dtSec)),
    y: r + (reflected ? period - offset : offset),
    vx: ball.vx,
    vy: reflected ? -ball.vy : ball.vy,
  };
}

/** The computer's paddle: follows an incoming ball, drifts home otherwise. */
export function computerPaddle(
  paddleY: number,
  ball: PongBall | undefined,
  dtSec: number,
  seat: PongSeat = 1
): number {
  const incoming = ball && (seat === 1 ? ball.vx > 0 : ball.vx < 0);
  const target = incoming ? ball.y : PONG_COURT.height / 2;
  const delta = target - paddleY;
  const reach = COMPUTER_SPEED * dtSec;
  return clampPaddle(paddleY + Math.max(-reach, Math.min(reach, delta)));
}

export type PongScore = {
  scores: [number, number];
  /** Who won the latest point, if any has been played. */
  lastScorer?: PongSeat;
};
export type PongPoint = { scorer: PongSeat };

/**
 * The seat that receives the next serve: whoever lost the latest point, and
 * at the start of a match, alternating sides round by round.
 */
export function nextServe(state: PongScore, round: number): PongSeat {
  if (state.lastScorer === undefined) return round % 2 === 0 ? 1 : 0;
  return state.lastScorer === 0 ? 1 : 0;
}

/**
 * A match is a series of points recorded by the first seat, whose client runs
 * the ball. Both players and every spectator replay the same score.
 */
export const pongRules: TurnRules<PongScore, PongPoint> = {
  seats: { min: 2, max: 2 },
  autoStart: true,
  initial: () => ({ scores: [0, 0] }),
  parseMove: (value) =>
    isRecord(value) && (value.scorer === 0 || value.scorer === 1)
      ? { scorer: value.scorer }
      : undefined,
  apply: (state, move) => {
    const scores: [number, number] = [...state.scores];
    scores[move.scorer] += 1;
    return { scores, lastScorer: move.scorer };
  },
  progress: (state) => {
    const winner = state.scores.findIndex(
      (score) => score >= PONG_POINTS_TO_WIN
    );
    return winner >= 0
      ? { t: 'over', winners: [winner] }
      : { t: 'turn', seat: 0 };
  },
  standings: (state) => [...state.scores],
};

/** What the host streams to the other player and spectators. */
export type PongCourtSnapshot = {
  round: number;
  /** Increments with every update, so a repeated heartbeat is not news. */
  seq: number;
  /**
   * When the sending tab opened (epoch ms). If the first seat runs the ball in
   * two tabs at once, the one open longest keeps it.
   */
  since: number;
  /**
   * Points played in the round when the snapshot was taken. A ball from
   * before the latest point belongs to a rally that already ended.
   */
  points: number;
  ball: PongBall | undefined;
  paddles: [number, number];
};

/** Decode a snapshot from another client's presence, rejecting anything odd. */
export function parseCourtSnapshot(
  value: unknown
): PongCourtSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const { round, seq, since, points, ball, paddles } = value;
  if (
    !isFiniteNumber(round) ||
    round < 0 ||
    !isFiniteNumber(seq) ||
    !isFiniteNumber(since) ||
    !isFiniteNumber(points) ||
    points < 0
  )
    return undefined;
  if (
    !Array.isArray(paddles) ||
    paddles.length !== 2 ||
    !paddles.every(isFiniteNumber)
  )
    return undefined;
  let parsedBall: PongBall | undefined;
  if (ball !== undefined && ball !== null) {
    if (!isRecord(ball)) return undefined;
    const { x, y, vx, vy } = ball;
    if (
      !isFiniteNumber(x) ||
      !isFiniteNumber(y) ||
      !isFiniteNumber(vx) ||
      !isFiniteNumber(vy)
    )
      return undefined;
    parsedBall = { x, y, vx, vy };
  }
  return {
    round: Math.floor(round),
    seq,
    since,
    points: Math.floor(points),
    ball: parsedBall,
    paddles: [clampPaddle(paddles[0]), clampPaddle(paddles[1])],
  };
}
