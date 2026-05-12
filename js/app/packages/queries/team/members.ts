import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import type { PatchTeamUserTierRequest } from '@service-auth/generated/schemas/patchTeamUserTierRequest';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { useMutation } from '@tanstack/solid-query';

import { authKeys } from '../auth';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { teamKeys } from './keys';
import { invalidateTeam } from './teams';

type PatchTeamUserTierArgs = {
  teamId: string;
  request: PatchTeamUserTierRequest;
};
type PatchTeamUserTierContext = { previousTeam: TeamWithMembers | undefined };
type PatchTeamUserTierCallbacks = MutationCallbacks<
  void,
  Error,
  PatchTeamUserTierArgs,
  PatchTeamUserTierContext
>;

export function usePatchTeamUserTierMutation(
  callbacks?: PatchTeamUserTierCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ request }: PatchTeamUserTierArgs) => {
      await throwOnErr(() => authServiceClient.patchTeamUserTier(request));
    },

    ...withCallbacks<
      void,
      Error,
      PatchTeamUserTierArgs,
      PatchTeamUserTierContext
    >(
      {
        onMutate: async ({ teamId, request }) => {
          const queryKey = teamKeys.detail(teamId).queryKey;
          await queryClient.cancelQueries({ queryKey });

          const previousTeam =
            queryClient.getQueryData<TeamWithMembers>(queryKey);

          queryClient.setQueryData<TeamWithMembers>(queryKey, (old) =>
            old
              ? {
                  ...old,
                  members: old.members.map((member) =>
                    member.user_id === request.team_user_id
                      ? { ...member, tier: request.new_tier }
                      : member
                  ),
                }
              : undefined
          );

          return { previousTeam };
        },

        onSuccess: (_data, { teamId, request }) => {
          invalidateTeam(teamId);

          const userInfo = queryClient.getQueryData<{
            userId: string;
            id: string;
          }>(authKeys.userInfo.queryKey);
          if (
            userInfo?.id === request.team_user_id ||
            userInfo?.userId === request.team_user_id
          ) {
            queryClient.invalidateQueries({
              queryKey: authKeys.userInfo.queryKey,
            });
            queryClient.invalidateQueries({
              queryKey: authKeys.userQuota.queryKey,
            });
          }
        },

        onError: (error, { teamId }, context) => {
          console.error('Failed to update team member tier', error);

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
