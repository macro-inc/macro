import { useLicenseStatus, useUserId } from '@core/context/user';
import { createEffect, on } from 'solid-js';
import { noteSawFreePlan } from './saw-free-plan';

/**
 * Record a known free license so a later upgrade can tell "never picked a
 * model" apart from a model chosen on a paid plan. Loading is not free:
 * `licenseStatus` stays empty until the user record arrives.
 */
export function useNoteFreePlanForModelDefault() {
  const userId = useUserId();
  const status = useLicenseStatus();
  createEffect(
    on(
      () => [userId(), status()] as const,
      ([id, license]) => {
        if (!id || !license) return;
        if (license === 'active' || license === 'trialing') return;
        noteSawFreePlan(id);
      }
    )
  );
}
