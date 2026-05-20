import {
  leadingAndTrailing,
  debounce as solidDebounce,
  throttle as solidThrottle,
} from '@solid-primitives/scheduled';
import { createEffect, createSignal, onCleanup } from 'solid-js';

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
) {
  return solidDebounce(func, delay);
}

/**
 * Create a debounced view of a signal.
 */
export function debouncedDependent<T>(source: () => T, delay = 300): () => T {
  const [debounced, setDebounced] = createSignal(source());
  const schedule = solidDebounce((v: T) => setDebounced(() => v), delay);
  createEffect(() => schedule(source()));
  onCleanup(() => schedule.clear());
  return debounced;
}

/**
 * Create a throttled view of a signal. Updates immediately on the first change,
 * then skips intermediate values during the cooldown period, catching the last
 * value at the trailing edge.
 */
export function throttledDependent<T>(source: () => T, delay = 150): () => T {
  const [throttled, setThrottled] = createSignal(source());
  const schedule = leadingAndTrailing(
    solidThrottle,
    (v: T) => setThrottled(() => v),
    delay
  );
  createEffect(() => schedule(source()));
  onCleanup(() => schedule.clear());
  return throttled;
}

/**
 * Create a lagged-on-true signal. A debounced view that is only debounced on
 * the leading edge. In the examples below (_) is the false state and (#) is the
 * true state. Signal B is a laggedGate on Signal A.
 *
 * Signal A ______##############__________
 * Signal B _____________#######__________
 *
 * @param source a boolean signal
 * @param delay the delay time in ms
 * @returns a derived signal
 */
function _laggedGate(source: () => boolean, delay = 300): () => boolean {
  const [follow, setFollow] = createSignal(source());
  const up = solidDebounce(() => setFollow(true), delay);
  createEffect(() => {
    const s = source();
    if (s) {
      up();
    } else {
      up.clear();
      setFollow(false);
    }
  });
  return follow;
}

/**
 * Create a cold-start lagged gate. Like {@link laggedGate} but always starts
 * `false`, even when the source is already `true` at creation time. The gate
 * opens only after the source has been continuously `true` for `delay` ms.
 * If the owning scope is disposed (e.g. component unmounts) before the delay
 * elapses the pending timer is cancelled and the gate never opens.
 *
 * Signal A ##############__________######
 * Signal B _______#######________________
 *
 * @param source a boolean signal
 * @param delay the delay time in ms
 * @returns a derived signal
 */
function _deferredGate(source: () => boolean, delay = 300): () => boolean {
  const [follow, setFollow] = createSignal(false);
  const up = solidDebounce(() => setFollow(true), delay);
  createEffect(() => {
    if (source()) {
      up();
    } else {
      up.clear();
      setFollow(false);
    }
  });
  return follow;
}

/**
 * Create a sticky-on-true signal. A debounced view that is only debounced on
 * the falling edge. In the examples below (_) is the false state and (#) is the
 * true state. Signal B is a stickyGate on Signal A.
 *
 * Signal A ______##############__________
 * Signal B ______###################_____
 *
 * @param source a boolean signal
 * @param delay the delay time in ms
 * @returns a derived signal
 */
function _stickyGate(source: () => boolean, delay = 300): () => boolean {
  const [follow, setFollow] = createSignal(source());
  const down = solidDebounce(() => setFollow(false), delay);
  createEffect(() => {
    const s = source();
    if (s) {
      down.clear();
      setFollow(true);
    } else {
      down();
    }
  });
  return follow;
}
