import { isRoutineLimitError } from '@app/lib/service-clients/service-scheduled-action/routine-limit';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { ThrownResultError } from '@core/util/result';
import type { QueryClient } from '@tanstack/solid-query';
import { getUpgradePlans } from './plans';

/**
 * Offer an upgrade when a routine write hit its plan's limit. On the top plan
 * there is nothing to offer; the write's own error message explains it.
 */
export function handleRoutineLimitError(error: unknown): boolean {
  if (!(error instanceof ThrownResultError)) return false;
  const limit = error.errors.find(isRoutineLimitError);
  if (!limit || getUpgradePlans(limit.plan).length === 0) return false;
  usePaywallState().showPaywall(PaywallKey.ROUTINE_LIMIT);
  return true;
}

/** Observe completed action failures, leaving background queries alone. */
export function observeRoutineLimitMutations(client: QueryClient) {
  return client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') {
      handleRoutineLimitError(event.action.error);
    }
  });
}
