import type { ComputerStatus } from '@service-auth/computers';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  formatElapsed,
  setupSettled,
  setupStepStartedAt,
} from '../core/setup-progress';

/**
 * How long the computer's current setup step has been running, as "0:42",
 * ticking every second while setup is still under way; undefined once it
 * settled.
 */
export function useSetupElapsed(
  computer: Accessor<ComputerStatus>
): Accessor<string | undefined> {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  return createMemo(() => {
    const current = computer();
    if (setupSettled(current)) return undefined;
    return formatElapsed(now() - setupStepStartedAt(current));
  });
}
