import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { useMutation } from '@tanstack/solid-query';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { teamKeys } from './keys';
import { invalidateTeam } from './teams';

type RemoveUserFromTeamArgs = { teamId: string; userId: string };
type RemoveUserFromTeamContext = { previousTeam: TeamWithMembers | undefined };
type RemoveUserFromTeamCallbacks = MutationCallbacks<
  void,
  Error,
  RemoveUserFromTeamArgs,
  RemoveUserFromTeamContext
>;

export function useRemoveUserFromTeamMutation(
  callbacks?: RemoveUserFromTeamCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ userId }: RemoveUserFromTeamArgs) => {
      await throwOnErr(() => authServiceClient.removeUserFromTeam(userId));
    },

    ...withCallbacks<
      void,
      Error,
      RemoveUserFromTeamArgs,
      RemoveUserFromTeamContext
    >(
      {
        onMutate: async ({ teamId, userId }) => {
          const queryKey = teamKeys.detail(teamId).queryKey;
          await queryClient.cancelQueries({ queryKey });

          const previousTeam =
            queryClient.getQueryData<TeamWithMembers>(queryKey);

          queryClient.setQueryData<TeamWithMembers>(queryKey, (old) =>
            old
              ? {
                  ...old,
                  members: old.members.filter(
                    (member) => member.user_id !== userId
                  ),
                }
              : undefined
          );

          return { previousTeam };
        },

        onSuccess: (_data, { teamId }) => {
          invalidateTeam(teamId);
          toast.success('Member removed');
        },

        onError: (error, { teamId }, context) => {
          console.error('Failed to remove user from team', error);
          toast.failure('Failed to remove team member');

          if (context?.previousTeam) {
            queryClient.setQueryData(
              teamKeys.detail(teamId).queryKey,
              context.previousTeam
            );
          }
        },
      },
      callbacks
    ),
  }));
}
