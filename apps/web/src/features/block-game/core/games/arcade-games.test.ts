import { describe, expect, it } from 'vitest';
import { createRandom } from '../random';
import { replayTurnMatch } from '../turn-match';
import {
  BRICK_BALL_RADIUS,
  BRICK_FIELD,
  BRICK_PADDLE,
  brickPoints,
  brickRect,
  createBrickBreaker,
  launchBall,
  stepBrickBreaker,
} from './brick-breaker';
import {
  BLOCKS_COLS,
  BLOCKS_ROWS,
  createFallingBlocks,
  type FallingBlocksState,
  gravityMs,
  hardDropBlocks,
  landingPiece,
  moveBlocks,
  PIECE_KINDS,
  pieceCells,
  rotateBlocks,
  tickBlocks,
} from './falling-blocks';
import {
  createFlappy,
  FLAPPY_BIRD,
  FLAPPY_GAP,
  FLAPPY_GROUND,
  FLAPPY_PIPE_WIDTH,
  flap,
  stepFlappy,
} from './flappy';
import {
  createInvaders,
  INVADER_COLS,
  INVADERS_PLAYER,
  invaderPosition,
  stepInvaders,
} from './invaders';
import {
  computerPaddle,
  extrapolateBall,
  nextServe,
  PONG_BALL_RADIUS,
  PONG_COURT,
  PONG_POINTS_TO_WIN,
  paddleFace,
  parseCourtSnapshot,
  pongRules,
  serveBall,
  stepPongBall,
} from './pong';

const random = () => createRandom(7);
const idle = { move: 0 };

describe('brick breaker', () => {
  it('keeps the ball on the paddle until launch, then sends it up', () => {
    let state = stepBrickBreaker(createBrickBreaker(), { move: 1 }, 100);
    expect(state.ball.x).toBe(state.paddleX);
    expect(state.paddleX).toBeGreaterThan(BRICK_FIELD.width / 2);
    state = launchBall(state, random());
    expect(state.launched).toBe(true);
    expect(state.ball.vy).toBeLessThan(0);
  });

  it('breaks a brick for points and bounces back down', () => {
    const target = brickRect(55); // bottom row
    const state = {
      ...createBrickBreaker(),
      launched: true,
      ball: {
        x: target.x + target.width / 2,
        y: target.y + target.height + BRICK_BALL_RADIUS + 0.2,
        vx: 0,
        vy: -50,
      },
    };
    const next = stepBrickBreaker(state, idle, 50);
    expect(next.bricks[55]).toBe(false);
    expect(next.score).toBe(brickPoints(target.row));
    expect(next.ball.vy).toBeGreaterThan(0);
  });

  it('returns the ball off the paddle and costs a ball when it is missed', () => {
    const falling = {
      ...createBrickBreaker(),
      launched: true,
      ball: { x: 50, y: BRICK_PADDLE.y - 2, vx: 0, vy: 60 },
    };
    expect(stepBrickBreaker(falling, idle, 50).ball.vy).toBeLessThan(0);

    const missed = {
      ...falling,
      paddleX: 10,
      ball: { ...falling.ball, x: 90 },
    };
    let state = stepBrickBreaker(missed, { move: 0, paddleX: 10 }, 400);
    expect(state.lives).toBe(2);
    expect(state.launched).toBe(false);
    state = { ...state, lives: 1, launched: true, ball: missed.ball };
    expect(stepBrickBreaker(state, { move: 0, paddleX: 10 }, 400).over).toBe(
      true
    );
  });

  it('starts the next level with the score kept once every brick is gone', () => {
    const target = brickRect(0);
    const state = {
      ...createBrickBreaker(),
      bricks: createBrickBreaker().bricks.map((_, index) => index === 0),
      score: 500,
      launched: true,
      ball: {
        x: target.x + target.width / 2,
        y: target.y + target.height + BRICK_BALL_RADIUS + 0.2,
        vx: 0,
        vy: -50,
      },
    };
    const next = stepBrickBreaker(state, idle, 50);
    expect(next.level).toBe(2);
    expect(next.score).toBe(500 + brickPoints(0));
    expect(next.bricks.every(Boolean)).toBe(true);
    expect(next.launched).toBe(false);
  });
});

describe('pong', () => {
  it('serves toward a seat and bounces off the walls', () => {
    expect(serveBall(0, random()).vx).toBeLessThan(0);
    expect(serveBall(1, random()).vx).toBeGreaterThan(0);
    const { ball } = stepPongBall(
      { x: 50, y: 1.5, vx: 0, vy: -40 },
      [30, 30],
      0.05
    );
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('returns the ball faster off a paddle and scores a miss', () => {
    const incoming = {
      x: paddleFace(0) + PONG_BALL_RADIUS + 0.2,
      y: 30,
      vx: -50,
      vy: 0,
    };
    const returned = stepPongBall(incoming, [30, 30], 0.05);
    expect(returned.returnedBy).toBe(0);
    expect(returned.ball.vx).toBeGreaterThan(50);

    const missed = stepPongBall(incoming, [5, 30], 0.2);
    expect(missed.scorer).toBe(1);
  });

  it('never returns the ball perfectly flat', () => {
    const dead = stepPongBall(
      { x: paddleFace(1) - PONG_BALL_RADIUS - 0.2, y: 30, vx: 50, vy: 0 },
      [30, 30],
      0.05
    );
    expect(dead.returnedBy).toBe(1);
    expect(Math.abs(dead.ball.vy)).toBeGreaterThan(5);
  });

  it('folds an extrapolated ball back into the court', () => {
    const ball = extrapolateBall({ x: 50, y: 50, vx: 10, vy: 40 }, 0.5);
    expect(ball.y).toBeGreaterThan(0);
    expect(ball.y).toBeLessThan(PONG_COURT.height);
    expect(ball.vy).toBeLessThan(0);
    expect(ball.x).toBe(55);
  });

  it('moves the computer paddle toward an incoming ball at a limited speed', () => {
    const ball = { x: 60, y: 50, vx: 30, vy: 0 };
    const moved = computerPaddle(30, ball, 0.1);
    expect(moved).toBeGreaterThan(30);
    expect(moved).toBeLessThan(50);
  });

  it('records points from the first seat and ends at seven', () => {
    const points = Array.from({ length: PONG_POINTS_TO_WIN }, () => ({
      t: 'move' as const,
      by: 'ann',
      move: { scorer: 1 },
    }));
    const match = replayTurnMatch(pongRules, [
      { t: 'join', by: 'ann' },
      { t: 'join', by: 'bob' },
      // Only the first seat runs the ball; Bob cannot award himself points.
      { t: 'move', by: 'bob', move: { scorer: 1 } },
      ...points,
    ]);
    expect(match.phase.t).toBe('over');
    expect(match.results[0]?.winners).toEqual(['bob']);
    expect(pongRules.parseMove({ scorer: 2 })).toBeUndefined();
  });

  it('serves to whoever lost the last point, alternating sides by round', () => {
    expect(nextServe(pongRules.initial(2, 0), 0)).toBe(1);
    expect(nextServe(pongRules.initial(2, 1), 1)).toBe(0);
    const afterBob = pongRules.apply(pongRules.initial(2, 0), { scorer: 1 }, 0);
    expect(afterBob && nextServe(afterBob, 0)).toBe(0);
    const afterAnn = afterBob && pongRules.apply(afterBob, { scorer: 0 }, 0);
    expect(afterAnn && nextServe(afterAnn, 0)).toBe(1);
  });

  it('accepts only well-formed court snapshots', () => {
    expect(
      parseCourtSnapshot({
        round: 0,
        seq: 3,
        since: 1_700_000_000_000,
        points: 4,
        ball: { x: 1, y: 2, vx: 3, vy: 4 },
        paddles: [30, 999],
      })
    ).toEqual({
      round: 0,
      seq: 3,
      since: 1_700_000_000_000,
      points: 4,
      ball: { x: 1, y: 2, vx: 3, vy: 4 },
      paddles: [30, PONG_COURT.height - 6],
    });
    expect(
      parseCourtSnapshot({
        round: 0,
        seq: 1,
        since: 1,
        points: 0,
        paddles: [1],
      })
    ).toBeUndefined();
    expect(
      parseCourtSnapshot({ round: 0, seq: 1, paddles: [1, 2] })
    ).toBeUndefined();
    expect(
      parseCourtSnapshot({ round: 0, seq: 1, since: 1, paddles: [1, 2] })
    ).toBeUndefined();
    expect(
      parseCourtSnapshot({
        round: 0,
        seq: 1,
        since: 1,
        points: 0,
        ball: { x: 'a' },
        paddles: [1, 2],
      })
    ).toBeUndefined();
  });
});

function withRow(state: FallingBlocksState, row: number, gap: number) {
  const board = [...state.board];
  for (let x = 0; x < BLOCKS_COLS; x += 1)
    if (x !== gap) board[row * BLOCKS_COLS + x] = 'O';
  return { ...state, board };
}

describe('falling blocks', () => {
  it('deals every piece once per bag', () => {
    const state = createFallingBlocks(random());
    const firstBag = [state.piece.kind, ...state.queue.slice(0, 6)];
    expect([...firstBag].sort()).toEqual([...PIECE_KINDS].sort());
  });

  it('moves and rotates within the walls', () => {
    let state = createFallingBlocks(random());
    for (let step = 0; step < 20; step += 1) state = moveBlocks(state, -1);
    expect(Math.min(...pieceCells(state.piece).map(([x]) => x))).toBe(0);
    const rotated = rotateBlocks(state, 1);
    expect(
      pieceCells(rotated.piece).every(([x]) => x >= 0 && x < BLOCKS_COLS)
    ).toBe(true);
  });

  it('hard drops for two points a row and clears a full line', () => {
    const start = createFallingBlocks(random());
    const state = {
      ...start,
      piece: { kind: 'I' as const, rotation: 1, x: 0, y: 0 },
    };
    // A vertical I in column 2 fills the gap in the bottom row.
    const aimed = { ...state, piece: { ...state.piece, x: 0 } };
    const column = Math.min(...pieceCells(aimed.piece).map(([x]) => x));
    const board = withRow(aimed, BLOCKS_ROWS - 1, column);
    const landing = landingPiece(board);
    const dropped = landing.y - board.piece.y;
    const next = hardDropBlocks(board, random());
    expect(next.lines).toBe(1);
    expect(next.score).toBe(dropped * 2 + 100);
    // The rest of the I settles one row lower after the clear.
    expect(next.board.slice(-BLOCKS_COLS).filter(Boolean)).toHaveLength(1);
  });

  it('locks a resting piece on a gravity step and tops out when blocked', () => {
    const start = createFallingBlocks(random());
    const resting = { ...start, piece: landingPiece(start) };
    const locked = tickBlocks(resting, random());
    expect(locked.board.some(Boolean)).toBe(true);
    expect(locked.piece.kind).toBe(start.queue[0]);

    // Nearly full rows (never a complete line) leave no room to spawn.
    const full = {
      ...start,
      board: start.board.map((_, index) =>
        index % BLOCKS_COLS === BLOCKS_COLS - 1 ? null : ('O' as const)
      ),
    };
    expect(hardDropBlocks(full, random()).over).toBe(true);
    expect(gravityMs(5)).toBeLessThan(gravityMs(1));
  });
});

describe('invaders', () => {
  it('shoots down an invader for its row points', () => {
    const state = createInvaders();
    const target = invaderPosition(state, 4 * INVADER_COLS + 4);
    const aimed = {
      ...state,
      playerX: target.x + 3,
      shot: { x: target.x + 3, y: target.y + 6 },
    };
    const next = stepInvaders(aimed, { move: 0, fire: false }, 50, random());
    expect(next.invaders[4 * INVADER_COLS + 4]).toBe(false);
    expect(next.score).toBe(10);
    expect(next.shot).toBeUndefined();
  });

  it('marches, then drops and turns at the edge', () => {
    let state = { ...createInvaders(), stepIn: 1 };
    const startX = state.formationX;
    state = stepInvaders(state, { move: 0, fire: false }, 16, random());
    expect(state.formationX).toBeGreaterThan(startX);

    const atEdge = { ...state, formationX: 50, stepIn: 1 };
    const turned = stepInvaders(atEdge, { move: 0, fire: false }, 16, random());
    expect(turned.direction).toBe(-1);
    expect(turned.formationY).toBeGreaterThan(state.formationY);
  });

  it('costs a life when a bomb lands, with a moment of safety after', () => {
    const state = {
      ...createInvaders(),
      bombs: [{ x: 50, y: INVADERS_PLAYER.y + 0.5 }],
      playerX: 50,
    };
    const hit = stepInvaders(state, { move: 0, fire: false }, 16, random());
    expect(hit.lives).toBe(2);
    expect(hit.recovering).toBeGreaterThan(0);
    expect(hit.bombs).toEqual([]);
  });

  it('brings a new wave when every invader is gone, and ends if they land', () => {
    const cleared = {
      ...createInvaders(),
      invaders: createInvaders().invaders.map(() => false),
      score: 900,
    };
    const next = stepInvaders(cleared, { move: 0, fire: false }, 16, random());
    expect(next.wave).toBe(2);
    expect(next.score).toBe(900);
    expect(next.invaders.every(Boolean)).toBe(true);

    const low = { ...createInvaders(), formationY: INVADERS_PLAYER.y - 20 };
    expect(stepInvaders(low, { move: 0, fire: false }, 16, random()).over).toBe(
      true
    );
  });
});

describe('flappy', () => {
  it('hovers until the first flap, then falls', () => {
    const start = createFlappy(random());
    expect(stepFlappy(start, 500, random())).toEqual(start);
    const flapped = stepFlappy(flap(start), 16, random());
    expect(flapped.birdY).toBeLessThan(start.birdY);
    let falling = flapped;
    for (let frame = 0; frame < 60; frame += 1)
      falling = stepFlappy(falling, 16, random());
    expect(falling.birdY).toBeGreaterThan(flapped.birdY);
  });

  it('scores a passed pipe and crashes into the ground', () => {
    const state = {
      ...flap(createFlappy(random())),
      velocity: 0,
      pipes: [
        {
          x: FLAPPY_BIRD.x - FLAPPY_PIPE_WIDTH + 0.1,
          gapY: FLAPPY_GROUND / 2,
          passed: false,
        },
      ],
    };
    const passed = stepFlappy(state, 16, random());
    expect(passed.score).toBe(1);

    const low = { ...passed, birdY: FLAPPY_GROUND - 1 };
    expect(stepFlappy(low, 16, random()).over).toBe(true);
  });

  it('crashes into a pipe outside its gap', () => {
    const state = {
      ...flap(createFlappy(random())),
      birdY: 20,
      velocity: 0,
      pipes: [
        {
          x: FLAPPY_BIRD.x - 2,
          gapY: 20 + FLAPPY_GAP,
          passed: false,
        },
      ],
    };
    expect(stepFlappy(state, 16, random()).over).toBe(true);
  });
});
