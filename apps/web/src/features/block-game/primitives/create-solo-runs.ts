import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import {
  chordCell,
  createMinesweeper,
  type MinesweeperState,
  revealCell,
  toggleFlag,
} from '../core/games/minesweeper';
import {
  createSnake,
  type Direction,
  type SnakeState,
  snakeStepMs,
  stepSnake,
  turnSnake,
} from '../core/games/snake';
import {
  createTwentyFortyEight,
  slideTwentyFortyEight,
  type TwentyFortyEightState,
} from '../core/games/twenty-forty-eight';
import { createRandom, type Random, randomSeed } from '../core/random';

export type RunPhase = 'ready' | 'playing' | 'paused' | 'over';

/**
 * A local Snake run. Steps come from a timer that speeds up as the snake
 * grows; `onFinish` receives the final score once.
 */
export function createSnakeRun(options: {
  onFinish: (score: number) => void;
  random?: Random;
}) {
  const random = options.random ?? createRandom(randomSeed());
  const [state, setState] = createSignal<SnakeState>(createSnake(random));
  const [phase, setPhase] = createSignal<RunPhase>('ready');

  // The step timer is an external system; it runs only while playing.
  createEffect(
    on(phase, (current) => {
      if (current !== 'playing') return;
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        const next = stepSnake(state(), random);
        setState(next);
        if (next.over) {
          setPhase('over');
          options.onFinish(next.score);
          return;
        }
        timer = setTimeout(tick, snakeStepMs(next.apples));
      };
      timer = setTimeout(tick, snakeStepMs(state().apples));
      onCleanup(() => clearTimeout(timer));
    })
  );

  const reset = () => {
    setState(createSnake(random));
    setPhase('ready');
  };

  return {
    state,
    phase,
    score: () => state().score,
    reset,
    /** Steering also starts a fresh run. */
    turn: (direction: Direction) => {
      if (phase() === 'over') return;
      setState((current) => turnSnake(current, direction));
      if (phase() === 'ready') setPhase('playing');
    },
    /** Begin playing; any run already under way starts over. */
    start: () => {
      if (phase() !== 'ready') reset();
      setPhase('playing');
    },
    togglePause: () => {
      if (phase() === 'playing') setPhase('paused');
      else if (phase() === 'paused') setPhase('playing');
    },
  };
}

/** A local 2048 run; the game ends when no slide can change the board. */
export function createTwentyFortyEightRun(options: {
  onFinish: (score: number) => void;
  random?: Random;
}) {
  const random = options.random ?? createRandom(randomSeed());
  const [state, setState] = createSignal<TwentyFortyEightState>(
    createTwentyFortyEight(random)
  );
  const [phase, setPhase] = createSignal<RunPhase>('ready');

  const reset = () => {
    setState(createTwentyFortyEight(random));
    setPhase('ready');
  };

  return {
    state,
    phase,
    score: () => state().score,
    reset,
    slide: (direction: Direction) => {
      if (phase() === 'over') return;
      const { state: next, moved } = slideTwentyFortyEight(
        state(),
        direction,
        random
      );
      if (!moved) return;
      setState(next);
      if (next.over) {
        setPhase('over');
        options.onFinish(next.score);
      } else if (phase() === 'ready') {
        setPhase('playing');
      }
    },
  };
}

/**
 * A local Minesweeper run, timed from the first reveal. Only a cleared board
 * finishes with a score, the clear time in milliseconds.
 */
export function createMinesweeperRun(options: {
  onFinish: (elapsedMs: number) => void;
  random?: Random;
}) {
  const random = options.random ?? createRandom(randomSeed());
  const [state, setState] = createSignal<MinesweeperState>(createMinesweeper());
  const [startedAt, setStartedAt] = createSignal<number>();
  const [endedAt, setEndedAt] = createSignal<number>();
  const [now, setNow] = createSignal(Date.now());

  const phase = (): RunPhase => {
    const status = state().status;
    if (status === 'ready') return 'ready';
    return status === 'playing' ? 'playing' : 'over';
  };

  // A display clock; the recorded time comes from start/end timestamps.
  createEffect(
    on(phase, (current) => {
      if (current !== 'playing') return;
      const timer = setInterval(() => setNow(Date.now()), 100);
      onCleanup(() => clearInterval(timer));
    })
  );

  const elapsed = () => {
    const start = startedAt();
    if (start === undefined) return 0;
    return (endedAt() ?? now()) - start;
  };

  const apply = (next: MinesweeperState) => {
    const before = state().status;
    setState(next);
    if (before === 'ready' && next.status !== 'ready') {
      setStartedAt(Date.now());
      setNow(Date.now());
    }
    if (next.status === 'won' || next.status === 'lost') {
      const end = Date.now();
      setEndedAt(end);
      if (next.status === 'won')
        options.onFinish(Math.max(1, end - (startedAt() ?? end)));
    }
  };

  const reset = () => {
    setState(createMinesweeper());
    setStartedAt(undefined);
    setEndedAt(undefined);
  };

  return {
    state,
    phase,
    elapsed,
    /** Clear time so far; the leaderboard ranks the fastest clear. */
    score: elapsed,
    reset,
    reveal: (index: number) => apply(revealCell(state(), index, random)),
    flag: (index: number) => apply(toggleFlag(state(), index)),
    chord: (index: number) => apply(chordCell(state(), index)),
  };
}
