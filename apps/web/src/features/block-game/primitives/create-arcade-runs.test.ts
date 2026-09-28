import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gravityMs } from '../core/games/falling-blocks';
import { createRandom } from '../core/random';
import {
  createBrickBreakerRun,
  createFallingBlocksRun,
  createFlappyRun,
} from './create-arcade-runs';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

function fakeFrames() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
}

function inRoot<T>(build: () => T): T {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return build();
  });
}

describe('arcade runs', () => {
  it('finishes a Flappy run once when the bird falls, then starts over', async () => {
    fakeFrames();
    const onFinish = vi.fn();
    const run = inRoot(() =>
      createFlappyRun({ onFinish, random: createRandom(1) })
    );
    run.flap();
    expect(run.phase()).toBe('playing');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run.phase()).toBe('over');
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(0);

    run.start();
    expect(run.phase()).toBe('playing');
    expect(run.state().over).toBe(false);
  });

  it('drops Falling Blocks on a gravity timer and pauses with the tab', async () => {
    fakeFrames();
    const run = inRoot(() =>
      createFallingBlocksRun({ onFinish: () => {}, random: createRandom(2) })
    );
    run.start();
    const top = run.state().piece.y;
    await vi.advanceTimersByTimeAsync(gravityMs(1) * 2 + 10);
    expect(run.state().piece.y).toBe(top + 2);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run.phase()).toBe('paused');
    const paused = run.state().piece.y;
    await vi.advanceTimersByTimeAsync(gravityMs(1) * 3);
    expect(run.state().piece.y).toBe(paused);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('keeps one gravity timer after a game ends on its own and restarts', async () => {
    fakeFrames();
    const onFinish = vi.fn();
    const run = inRoot(() =>
      createFallingBlocksRun({ onFinish, random: createRandom(4) })
    );
    run.start();
    // Untouched pieces stack in the middle until one lands at the top.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run.phase()).toBe('over');
    expect(onFinish).toHaveBeenCalledTimes(1);

    run.start();
    const top = run.state().piece.y;
    await vi.advanceTimersByTimeAsync(gravityMs(1) * 2 + 10);
    expect(run.state().piece.y).toBe(top + 2);
  });

  it('launches Brick Breaker from the paddle and moves it with held keys', async () => {
    fakeFrames();
    const run = inRoot(() =>
      createBrickBreakerRun({ onFinish: () => {}, random: createRandom(3) })
    );
    run.pointer(20);
    expect(run.state().paddleX).toBe(20);
    run.launch();
    expect(run.phase()).toBe('playing');
    expect(run.state().ball.vy).toBeLessThan(0);
    run.keyDown('ArrowRight');
    await vi.advanceTimersByTimeAsync(200);
    expect(run.state().paddleX).toBeGreaterThan(20);
  });
});
