import { Telemetry } from '@macro-inc/observability';

/**
 * Starts `work` without waiting for it, reporting a rejection to Telemetry
 * under `surface`. Use it when nothing needs the result and a failure needs no
 * recovery; when it does (reset state, show a toast), handle the rejection
 * where the work starts instead.
 */
export function fireAndForget(work: unknown, surface: string): void {
  Promise.resolve(work).catch((error: unknown) => {
    Telemetry.error(error, { surface });
  });
}
