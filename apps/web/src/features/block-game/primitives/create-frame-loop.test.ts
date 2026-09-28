import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameLoop } from './create-frame-loop';

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
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
}

function inRoot(build: () => void) {
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    build();
  });
}

/** Frames arrive every 16ms, so this many land in `ms`, give or take one. */
const framesIn = (ms: number) => ms / 16;

describe('createFrameLoop', () => {
  it('stops for good when a frame ends the run, and restarts once', async () => {
    fakeFrames();
    const [running, setRunning] = createSignal(true);
    let frames = 0;
    inRoot(() =>
      createFrameLoop({
        running,
        onFrame: () => {
          frames += 1;
          if (frames === 3) setRunning(false);
        },
      })
    );
    await vi.advanceTimersByTimeAsync(480);
    expect(frames).toBe(3);

    setRunning(true);
    await vi.advanceTimersByTimeAsync(480);
    expect(frames - 3).toBeGreaterThanOrEqual(framesIn(480) - 1);
    expect(frames - 3).toBeLessThanOrEqual(framesIn(480) + 1);
  });

  it('keeps one loop while what `running` reads changes every frame', async () => {
    fakeFrames();
    const [count, setCount] = createSignal(0);
    inRoot(() =>
      createFrameLoop({
        running: () => count() >= 0,
        onFrame: () => setCount((current) => current + 1),
      })
    );
    await vi.advanceTimersByTimeAsync(480);
    expect(count()).toBeGreaterThanOrEqual(framesIn(480) - 1);
    expect(count()).toBeLessThanOrEqual(framesIn(480) + 1);
  });

  it('stops when its owner is disposed', async () => {
    fakeFrames();
    let frames = 0;
    inRoot(() =>
      createFrameLoop({ running: () => true, onFrame: () => (frames += 1) })
    );
    await vi.advanceTimersByTimeAsync(100);
    dispose?.();
    const stoppedAt = frames;
    await vi.advanceTimersByTimeAsync(100);
    expect(frames).toBe(stoppedAt);
  });
});
