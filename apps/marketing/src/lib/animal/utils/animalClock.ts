import { createEffect, createRoot, createSignal, on, untrack } from 'solid-js';
import type { AnimateOptions } from '../types/animalTypes';
import { getEasingFn } from './animalInterpolate';

export const [time, setTime] = createSignal(0);

// The clock is reference-counted by animate() subscriptions: it only ticks
// while at least one animation is live, so routes (or scenes paused while
// offscreen) with no subscribers cost zero rAF work. Time stays monotonic
// from performance.now(), so phase is preserved across stop/start.
let subscriberCount = 0;
let rafId = 0;
let running = false;

function tick() {
  setTime(performance.now() / 1000);
  rafId = requestAnimationFrame(tick);
}

function addClockSubscriber() {
  subscriberCount++;
  if (!running) {
    running = true;
    setTime(performance.now() / 1000);
    rafId = requestAnimationFrame(tick);
  }
}

function removeClockSubscriber() {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0 && running) {
    running = false;
    cancelAnimationFrame(rafId);
  }
}

export function animate(options: AnimateOptions) {
  const { duration, timeline, loop = false } = options;
  const keys = Object.keys(timeline)
    .map(Number)
    .sort((a, b) => a - b);

  // Wrap dispose so the subscriber count survives double-disposal (non-loop
  // animations dispose themselves AND call sites call the returned cleanup).
  let disposed = false;
  let stop: () => void = () => {};
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    removeClockSubscriber();
    stop();
  };
  addClockSubscriber();
  // Capture the start AFTER subscribing so a freshly restarted clock doesn't
  // hand non-loop animations a stale elapsed time. untrack() matters: callers
  // invoke animate() inside visibility-gating effects, and a tracked read
  // would subscribe that effect to the clock — recreating the animation
  // every frame and freezing it at progress 0.
  const startTime = untrack(time);

  createRoot(function (dispose) {
    stop = dispose;
    createEffect(
      on(time, function (t) {
        let elapsed;
        if (loop) {
          elapsed = (t - startTime) % duration;
        } else {
          elapsed = t - startTime;
          if (elapsed > duration) {
            cleanup();
            return;
          }
        }

        const progress = Math.min(elapsed / duration, 1);

        let fromIdx = 0;
        for (let i = keys.length - 1; i >= 0; i--) {
          if (progress >= keys[i]) {
            fromIdx = i;
            break;
          }
        }
        const toIdx = (fromIdx + 1) % keys.length;

        const fromProgress = keys[fromIdx];
        const toProgress = toIdx === 0 ? 1 : keys[toIdx];
        const range = toProgress - fromProgress;

        const localProgress = range > 0 ? (progress - fromProgress) / range : 0;

        const fromFrame = timeline[keys[fromIdx]];
        const toFrame = timeline[keys[toIdx]];

        const toValues = new Map<(v: number) => void, number>();
        for (const v of toFrame) {
          toValues.set(v.signal, v.value);
        }

        for (const from of fromFrame) {
          const toValue = toValues.get(from.signal) ?? from.value;
          const easing = getEasingFn(from);
          const easedProgress = easing(localProgress);
          const value = from.value + (toValue - from.value) * easedProgress;
          from.signal(value);
        }
      })
    );
  });

  return cleanup;
}
