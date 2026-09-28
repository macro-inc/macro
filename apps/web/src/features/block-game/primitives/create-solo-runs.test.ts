import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snakeStepMs } from '../core/games/snake';
import { createRandom } from '../core/random';
import { createSnakeRun } from './create-solo-runs';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

describe('createSnakeRun', () => {
  it('starts over from a run that is playing or paused', async () => {
    vi.useFakeTimers();
    const run = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createSnakeRun({ onFinish: () => {}, random: createRandom(1) });
    });
    const fresh = run.state().body;
    run.start();
    await vi.advanceTimersByTimeAsync(snakeStepMs(0) * 2 + 10);
    expect(run.state().body).not.toEqual(fresh);

    run.start();
    expect(run.phase()).toBe('playing');
    expect(run.state().body).toEqual(fresh);

    await vi.advanceTimersByTimeAsync(snakeStepMs(0) + 10);
    run.togglePause();
    expect(run.phase()).toBe('paused');
    run.start();
    expect(run.phase()).toBe('playing');
    expect(run.state().body).toEqual(fresh);
  });
});
