import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';

/** Longest step a frame may simulate; a backgrounded tab resumes without a jump. */
const MAX_FRAME_MS = 50;

/**
 * Call `onFrame` with the elapsed milliseconds on every animation frame while
 * `running` is true. The frame clock is an external system, so it lives in an
 * effect and stops with its owner.
 */
export function createFrameLoop(options: {
  running: Accessor<boolean>;
  onFrame: (dtMs: number, now: number) => void;
}) {
  // Memoized so the loop restarts only when `running` flips, not whenever
  // something it reads changes.
  const running = createMemo(options.running);
  createEffect(
    on(running, (isRunning) => {
      if (!isRunning) return;
      const schedule =
        typeof requestAnimationFrame === 'function'
          ? (callback: FrameRequestCallback) => requestAnimationFrame(callback)
          : (callback: FrameRequestCallback) =>
              setTimeout(
                () => callback(performance.now()),
                16
              ) as unknown as number;
      const cancel =
        typeof cancelAnimationFrame === 'function'
          ? (handle: number) => cancelAnimationFrame(handle)
          : (handle: number) => clearTimeout(handle);
      let stopped = false;
      let last = performance.now();
      let handle = schedule(function frame(now) {
        const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - last));
        last = now;
        options.onFrame(dt, now);
        // A frame can stop its own loop, such as by ending the game.
        if (!stopped) handle = schedule(frame);
      });
      onCleanup(() => {
        stopped = true;
        cancel(handle);
      });
    })
  );
}
