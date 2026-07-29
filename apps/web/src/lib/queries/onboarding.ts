/**
 * Queries and mutations for the onboarding flow row.
 *
 * The server observes connections itself: reading the state starts any due
 * import gather runs, and connector OAuth completions reconcile instantly
 * via a server hook. All import state lives in `@queries/import`.
 */
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type OnboardingState,
  onboardingClient,
} from '@service-cognition/onboarding';
import { useMutation, useQuery } from '@tanstack/solid-query';

export type {
  ConnectedServer,
  OnboardingRow,
  OnboardingState,
  OnboardingStatus,
} from '@service-cognition/onboarding';

const KEYS = {
  state: ['onboarding', 'state'] as const,
};

/**
 * Non-suspending placeholder: an active flow with nothing known yet (see
 * the import query for why polling queries here never suspend).
 */
const PENDING_ONBOARDING_STATE: OnboardingState = {
  row: {
    status: 'active',
    skipped: false,
    started_at: '1970-01-01T00:00:00.000Z',
  },
  connected_servers: [],
};

/** The onboarding row + connections. Polling keeps gather runs starting. */
export function useOnboardingQuery(options?: { enabled?: () => boolean }) {
  return useQuery(() => ({
    queryKey: KEYS.state,
    queryFn: async () => throwOnErr(() => onboardingClient.getState()),
    enabled: options?.enabled ? options.enabled() : true,
    refetchInterval: 12_000,
    placeholderData: PENDING_ONBOARDING_STATE,
  }));
}

function invalidateOnboarding() {
  return queryClient.invalidateQueries({ queryKey: KEYS.state });
}

export function useCompleteOnboardingMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { skipped: boolean }) =>
      throwOnErr(() => onboardingClient.complete(args)),
    onSuccess: () => void invalidateOnboarding(),
  }));
}
