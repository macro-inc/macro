import { type Accessor, createSignal, onCleanup } from 'solid-js';

/**
 * Milliseconds until a ring stops, clamped to its full duration. Wall-clock
 * time keeps the bar aligned with dismissal after a background tab resumes.
 */
export function createRingCountdown(
  expiresAt: Accessor<string>,
  durationMs: number
) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 100);
  onCleanup(() => clearInterval(timer));

  return () =>
    Math.max(0, Math.min(durationMs, Date.parse(expiresAt()) - now()));
}
