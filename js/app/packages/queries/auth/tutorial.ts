import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { authKeys } from './keys';

type CompleteTutorialCallbacks = MutationCallbacks<void, Error, void>;

export function useCompleteTutorialMutation(
  callbacks?: CompleteTutorialCallbacks
) {
  return useMutation(() => ({
    mutationFn: async () => {
      await throwOnErr(
        async () =>
          await authServiceClient.patchUserTutorial({ tutorialComplete: true })
      );
    },
    ...withCallbacks<void, Error, void>(
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
