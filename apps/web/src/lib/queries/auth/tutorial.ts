import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { authKeys } from './keys';
import type { UserInfoData } from './user-info';

type TutorialContext = { userId: string | undefined };
type CompleteTutorialCallbacks = MutationCallbacks<
  void,
  Error,
  void,
  TutorialContext
>;

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
    ...withCallbacks<void, Error, void, TutorialContext>(
      {
        onMutate: () => ({
          userId: queryClient.getQueryData<UserInfoData>(
            authKeys.userInfo.queryKey
          )?.userId,
        }),
        onSuccess: async (_data, _variables, context) => {
          if (!context?.userId) return;
          // The PATCH confirms this value. Stop older reads from replacing it
          // before publishing it to the auth gate that ends onboarding.
          await queryClient.cancelQueries({
            queryKey: authKeys.userInfo.queryKey,
          });
          queryClient.setQueryData<UserInfoData>(
            authKeys.userInfo.queryKey,
            (user) =>
              user && user.userId === context.userId
                ? { ...user, tutorialComplete: true }
                : user
          );
        },
      },
      callbacks
    ),
  }));
}
