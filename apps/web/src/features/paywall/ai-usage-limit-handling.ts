import {
  isAiDenyCode,
  isAiUsageLimitError,
} from '@app/lib/service-clients/ai-usage-limit';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { ThrownResultError } from '@core/util/result';
import type { QueryClient } from '@tanstack/solid-query';

/** Present a typed AI refusal at a user-action boundary. Other errors stay local. */
export function handleAiUsageLimitError(error: unknown): boolean {
  const errors = error instanceof ThrownResultError ? error.errors : error;
  const limit = Array.isArray(errors)
    ? errors.find(isAiUsageLimitError)
    : isAiUsageLimitError(errors)
      ? errors
      : undefined;
  if (!limit) return false;
  showAiUsageLimit(limit.reason);
  return true;
}

/** Live chat tools report a reason code rather than an HTTP response. */
export function showAiUsageLimit(reason: string): void {
  if (isAiDenyCode(reason)) useAiUsageLimitState().showUsageLimit(reason);
}

/** Observe completed action failures, leaving background queries alone. */
export function observeAiUsageLimitMutations(client: QueryClient) {
  return client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') {
      handleAiUsageLimitError(event.action.error);
    }
  });
}
