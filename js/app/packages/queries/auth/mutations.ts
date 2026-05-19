import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { PatchUserOnboardingRequest } from '@service-auth/generated/schemas/patchUserOnboardingRequest';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { authKeys } from './keys';

type CompleteOnboardingCallbacks = MutationCallbacks<
  void,
  Error,
  PatchUserOnboardingRequest
>;

/** Mutation for completing user onboarding. */
export function useCompleteOnboardingMutation(
  callbacks?: CompleteOnboardingCallbacks
) {
  return useMutation(() => ({
    mutationFn: async (args: PatchUserOnboardingRequest) => {
      await throwOnErr(
        async () => await authServiceClient.completeOnboarding(args)
      );
    },
    ...withCallbacks<void, Error, PatchUserOnboardingRequest>(
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: authKeys.userInfo.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}

type SetGroupCallbacks = MutationCallbacks<void, Error, { group: string }>;

/** Mutation for setting the user's group (for A/B testing). */
export function useSetGroupMutation(callbacks?: SetGroupCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: { group: string }) => {
      await throwOnErr(async () => await authServiceClient.setGroup(args));
    },
    ...withCallbacks<void, Error, { group: string }>(
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: authKeys.userInfo.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}
