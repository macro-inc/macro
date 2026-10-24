import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { secondsLeft } from '../core/pairing';

/** Seconds left before `expiresAt`, ticking once a second while mounted. */
export function createCountdown(
  expiresAt: Accessor<string | undefined>
): Accessor<number | undefined> {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  return () => {
    const deadline = expiresAt();
    return deadline === undefined ? undefined : secondsLeft(deadline, now());
  };
}
