import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { TeamInvitesResponse } from '@service-auth/generated/schemas/teamInvitesResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { teamKeys } from './keys';
import { invalidateUserTeams } from './teams';

export function useUserInvitesQuery() {
  return useQuery(() => ({
    queryKey: teamKeys.userInvites.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getUserInvites()),
  }));
}

export function invalidateUserInvites() {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.userInvites.queryKey,
  });
}

type JoinTeamArgs = { teamInviteId: string };
type JoinTeamContext = { previousInvites: TeamInvitesResponse | undefined };
type JoinTeamCallbacks = MutationCallbacks<
  void,
  Error,
  JoinTeamArgs,
  JoinTeamContext
>;

export function useJoinTeamMutation(callbacks?: JoinTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ teamInviteId }: JoinTeamArgs) => {
      await throwOnErr(() => authServiceClient.joinTeam(teamInviteId));
    },

    ...withCallbacks<void, Error, JoinTeamArgs, JoinTeamContext>(
      {
        onMutate: async ({ teamInviteId }) => {
          await queryClient.cancelQueries({
            queryKey: teamKeys.userInvites.queryKey,
          });

          const previousInvites = queryClient.getQueryData<TeamInvitesResponse>(
            teamKeys.userInvites.queryKey
          );

          queryClient.setQueryData<TeamInvitesResponse>(
            teamKeys.userInvites.queryKey,
            (old) =>
              old
                ? {
                    invites: old.invites.filter(
                      (invite) => invite.id !== teamInviteId
                    ),
                  }
                : undefined
          );

          return { previousInvites };
        },

        onSuccess: () => {
          invalidateUserTeams();
          invalidateUserInvites();
          toast.success('Joined team');
        },

        onError: (error, _vars, context) => {
          console.error('Failed to join team', error);
          toast.failure('Failed to join team');

          if (context?.previousInvites) {
            queryClient.setQueryData(
              teamKeys.userInvites.queryKey,
              context.previousInvites
            );
          }
        },
      },
      callbacks
    ),
  }));
}

type RejectInvitationArgs = { teamInviteId: string };
type RejectInvitationContext = {
  previousInvites: TeamInvitesResponse | undefined;
};
type RejectInvitationCallbacks = MutationCallbacks<
  void,
  Error,
  RejectInvitationArgs,
  RejectInvitationContext
>;

export function useRejectInvitationMutation(
  callbacks?: RejectInvitationCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ teamInviteId }: RejectInvitationArgs) => {
      await throwOnErr(() => authServiceClient.rejectInvitation(teamInviteId));
    },

    ...withCallbacks<
      void,
      Error,
      RejectInvitationArgs,
      RejectInvitationContext
    >(
      {
        onMutate: async ({ teamInviteId }) => {
          await queryClient.cancelQueries({
            queryKey: teamKeys.userInvites.queryKey,
          });

          const previousInvites = queryClient.getQueryData<TeamInvitesResponse>(
            teamKeys.userInvites.queryKey
          );

          queryClient.setQueryData<TeamInvitesResponse>(
            teamKeys.userInvites.queryKey,
            (old) =>
              old
                ? {
                    invites: old.invites.filter(
                      (invite) => invite.id !== teamInviteId
                    ),
                  }
                : undefined
          );

          return { previousInvites };
        },

        onSuccess: () => {
          invalidateUserInvites();
          toast.success('Invitation declined');
        },

        onError: (error, _vars, context) => {
          console.error('Failed to reject invitation', error);
          toast.failure('Failed to reject invitation');

          if (context?.previousInvites) {
            queryClient.setQueryData(
              teamKeys.userInvites.queryKey,
              context.previousInvites
            );
          }
        },
      },
      callbacks
    ),
  }));
}
