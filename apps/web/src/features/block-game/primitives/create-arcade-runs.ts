import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type BrickBreakerState,
  createBrickBreaker,
  launchBall,
  stepBrickBreaker,
} from '../core/games/brick-breaker';
import {
  createFallingBlocks,
  type FallingBlocksState,
  gravityMs,
  hardDropBlocks,
  moveBlocks,
  rotateBlocks,
  softDropBlocks,
  tickBlocks,
} from '../core/games/falling-blocks';
import {
  createFlappy,
  type FlappyState,
  flap,
  stepFlappy,
} from '../core/games/flappy';
import {
  createInvaders,
  type InvadersState,
  stepInvaders,
} from '../core/games/invaders';
import { createRandom, type Random, randomSeed } from '../core/random';
import { createFrameLoop } from './create-frame-loop';
import type { RunPhase } from './create-solo-runs';
import { createHeldKeys, LEFT_KEYS, RIGHT_KEYS } from './held-keys';

type RunOptions = {
  onFinish: (score: number) => void;
  random?: Random;
};

/**
 * Phase and lifecycle shared by real-time solo games: runs start, pause and
 * resume, and `onFinish` receives the final score once per run.
 */
function createRunPhase<State extends { over: boolean; score: number }>(
  initial: () => State,
  onFinish: (score: number) => void
) {
  const [state, setState] = createSignal<State>(initial());
  const [phase, setPhase] = createSignal<RunPhase>('ready');
  const pause = () => {
    if (phase() === 'playing') setPhase('paused');
  };
  // Leaving the tab pauses a run instead of letting it play out unseen.
  if (typeof document !== 'undefined') {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() =>
      document.removeEventListener('visibilitychange', onVisibility)
    );
  }
  const reset = () => {
    setState(() => initial());
    setPhase('ready');
  };
  const update = (next: State) => {
    setState(() => next);
    if (next.over && phase() !== 'over') {
      setPhase('over');
      onFinish(next.score);
    }
  };
  return {
    state,
    phase,
    setPhase,
    update,
    score: () => state().score,
    reset,
    pause,
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

/** Brick Breaker: the paddle follows the pointer or arrow keys. */
export function createBrickBreakerRun(options: RunOptions) {
  const random = options.random ?? createRandom(randomSeed());
  const keys = createHeldKeys();
  const run = createRunPhase<BrickBreakerState>(
    createBrickBreaker,
    options.onFinish
  );
  let pointerX: number | undefined;

  createFrameLoop({
    running: () => run.phase() === 'playing',
    onFrame: (dtMs) =>
      run.update(
        stepBrickBreaker(
          run.state(),
          { move: keys.axis(LEFT_KEYS, RIGHT_KEYS), paddleX: pointerX },
          dtMs
        )
      ),
  });

  const launch = () => {
    const phase = run.phase();
    if (phase === 'over') return;
    if (phase !== 'playing') run.setPhase('playing');
    run.update(launchBall(run.state(), random));
  };

  return {
    ...run,
    launch,
    /** Hold the paddle under the pointer, in field units. */
    pointer: (x: number) => {
      pointerX = x;
      // Before the first launch, the paddle still follows the pointer.
      if (run.phase() === 'ready')
        run.update(stepBrickBreaker(run.state(), { move: 0, paddleX: x }, 0));
    },
    keyDown: (key: string) => {
      pointerX = undefined;
      keys.press(key);
    },
    keyUp: (key: string) => keys.release(key),
    blur: () => keys.clear(),
  };
}

/** Falling Blocks: gravity ticks on a timer that quickens with each level. */
export function createFallingBlocksRun(options: RunOptions) {
  const random = options.random ?? createRandom(randomSeed());
  const run = createRunPhase<FallingBlocksState>(
    () => createFallingBlocks(random),
    options.onFinish
  );
  const level = createMemo(() =>
    run.phase() === 'playing' ? run.state().level : undefined
  );

  // The gravity timer is an external system that runs only while playing.
  createEffect(
    on(level, (current) => {
      if (current === undefined) return;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        run.update(tickBlocks(run.state(), random));
        // Ending the run or reaching a new level restarts this effect.
        if (!stopped) timer = setTimeout(tick, gravityMs(run.state().level));
      };
      timer = setTimeout(tick, gravityMs(current));
      onCleanup(() => {
        stopped = true;
        clearTimeout(timer);
      });
    })
  );

  const act = (step: (state: FallingBlocksState) => FallingBlocksState) => {
    const phase = run.phase();
    if (phase === 'over' || phase === 'paused') return;
    if (phase === 'ready') run.setPhase('playing');
    run.update(step(run.state()));
  };

  return {
    ...run,
    left: () => act((state) => moveBlocks(state, -1)),
    right: () => act((state) => moveBlocks(state, 1)),
    rotate: () => act((state) => rotateBlocks(state, 1)),
    rotateBack: () => act((state) => rotateBlocks(state, -1)),
    softDrop: () => act((state) => softDropBlocks(state, random)),
    hardDrop: () => act((state) => hardDropBlocks(state, random)),
  };
}

/** Invaders: move with the pointer or arrow keys, fire with Space or a click. */
export function createInvadersRun(options: RunOptions) {
  const random = options.random ?? createRandom(randomSeed());
  const keys = createHeldKeys();
  const run = createRunPhase<InvadersState>(createInvaders, options.onFinish);
  let pointerX: number | undefined;
  let fireQueued = false;

  createFrameLoop({
    running: () => run.phase() === 'playing',
    onFrame: (dtMs) => {
      const fire = fireQueued || keys.axis([], [' ']) === 1;
      fireQueued = false;
      run.update(
        stepInvaders(
          run.state(),
          { move: keys.axis(LEFT_KEYS, RIGHT_KEYS), playerX: pointerX, fire },
          dtMs,
          random
        )
      );
    },
  });

  const begin = () => {
    if (run.phase() === 'ready') run.setPhase('playing');
  };

  return {
    ...run,
    fire: () => {
      if (run.phase() === 'over' || run.phase() === 'paused') return;
      begin();
      fireQueued = true;
    },
    pointer: (x: number) => {
      pointerX = x;
    },
    keyDown: (key: string) => {
      if (run.phase() === 'over') return;
      pointerX = undefined;
      keys.press(key);
      if (run.phase() === 'ready') begin();
    },
    keyUp: (key: string) => keys.release(key),
    blur: () => keys.clear(),
  };
}

/** Flappy: every flap lifts the bird; the first flap starts the run. */
export function createFlappyRun(options: RunOptions) {
  const random = options.random ?? createRandom(randomSeed());
  const run = createRunPhase<FlappyState>(
    () => createFlappy(random),
    options.onFinish
  );

  createFrameLoop({
    running: () => run.phase() === 'playing',
    onFrame: (dtMs) => run.update(stepFlappy(run.state(), dtMs, random)),
  });

  return {
    ...run,
    flap: () => {
      const phase = run.phase();
      if (phase === 'over') return;
      if (phase !== 'playing') run.setPhase('playing');
      run.update(flap(run.state()));
    },
  };
}
