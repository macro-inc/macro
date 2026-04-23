import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import type { CreateTeamRequest } from '@service-auth/generated/schemas/createTeamRequest';
import type { InviteToTeamRequest } from '@service-auth/generated/schemas/inviteToTeamRequest';
import type { PatchTeamRequest } from '@service-auth/generated/schemas/patchTeamRequest';
import type { PatchTeamUserTierRequest } from '@service-auth/generated/schemas/patchTeamUserTierRequest';
import type { Team } from '@service-auth/generated/schemas/team';
import type { TeamInvitesResponse } from '@service-auth/generated/schemas/teamInvitesResponse';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { useMutation } from '@tanstack/solid-query';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { teamKeys } from './keys';
import {
  invalidateTeam,
  invalidateTeamInvites,
  invalidateUserInvites,
  invalidateUserTeams,
} from './queries';

type CreateTeamArgs = CreateTeamRequest;
type CreateTeamCallbacks = MutationCallbacks<Team, Error, CreateTeamArgs>;

export function useCreateTeamMutation(callbacks?: CreateTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: CreateTeamArgs) =>
      await throwOnErr(() => authServiceClient.createTeam(args)),

    ...withCallbacks<Team, Error, CreateTeamArgs>(
      {
        onSuccess: () => {
          invalidateUserTeams();
          toast.success('Team created');
        },

        onError: (error) => {
          console.error('Failed to create team', error);
          toast.failure('Failed to create team');
        },
      },
      callbacks
    ),
  }));
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

type PatchTeamArgs = { teamId: string; request: PatchTeamRequest };
type PatchTeamCallbacks = MutationCallbacks<void, Error, PatchTeamArgs>;

export function usePatchTeamMutation(callbacks?: PatchTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ teamId, request }: PatchTeamArgs) => {
      await throwOnErr(() => authServiceClient.patchTeam(teamId, request));
    },

    ...withCallbacks<void, Error, PatchTeamArgs>(
      {
        onSuccess: (_data, { teamId }) => {
          invalidateTeam(teamId);
          invalidateUserTeams();
          toast.success('Team updated');
        },

        onError: (error) => {
          console.error('Failed to update team', error);
          toast.failure('Failed to update team');
        },
      },
      callbacks
    ),
  }));
}

type PatchTeamUserTierArgs = {
  teamId: string;
  request: PatchTeamUserTierRequest;
};
type PatchTeamUserTierCallbacks = MutationCallbacks<
  void,
  Error,
  PatchTeamUserTierArgs
>;

export function usePatchTeamUserTierMutation(
  callbacks?: PatchTeamUserTierCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ teamId, request }: PatchTeamUserTierArgs) => {
      await throwOnErr(() =>
        authServiceClient.patchTeamUserTier(teamId, request)
      );
    },

    ...withCallbacks<void, Error, PatchTeamUserTierArgs>(
      {
        onSuccess: (_data, { teamId }) => {
          invalidateTeam(teamId);
          toast.success('Member tier updated');
        },

        onError: (error) => {
          console.error('Failed to update team member tier', error);
          toast.failure('Failed to update team member tier');
        },
      },
      callbacks
    ),
  }));
}

type InviteToTeamArgs = { teamId: string; request: InviteToTeamRequest };
type InviteToTeamCallbacks = MutationCallbacks<void, Error, InviteToTeamArgs>;

export function useInviteToTeamMutation(callbacks?: InviteToTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ teamId, request }: InviteToTeamArgs) => {
      await throwOnErr(() => authServiceClient.inviteToTeam(teamId, request));
    },

    ...withCallbacks<void, Error, InviteToTeamArgs>(
      {
        onSuccess: (_data, { teamId }) => {
          invalidateTeamInvites(teamId);
          toast.success('Invitation sent');
        },

        onError: (error) => {
          console.error('Failed to invite to team', error);
          toast.failure('Failed to send invitation');
        },
      },
      callbacks
    ),
  }));
}

type DeleteTeamInviteArgs = { teamId: string; teamInviteId: string };
type DeleteTeamInviteContext = {
  previousInvites: TeamInvitesResponse | undefined;
};
type DeleteTeamInviteCallbacks = MutationCallbacks<
  void,
  Error,
  DeleteTeamInviteArgs,
  DeleteTeamInviteContext
>;

export function useDeleteTeamInviteMutation(
  callbacks?: DeleteTeamInviteCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ teamId, teamInviteId }: DeleteTeamInviteArgs) => {
      await throwOnErr(() =>
        authServiceClient.deleteTeamInvite(teamId, teamInviteId)
      );
    },

    ...withCallbacks<
      void,
      Error,
      DeleteTeamInviteArgs,
      DeleteTeamInviteContext
    >(
      {
        onMutate: async ({ teamId, teamInviteId }) => {
          const queryKey = teamKeys.invites(teamId).queryKey;
          await queryClient.cancelQueries({ queryKey });

          const previousInvites =
            queryClient.getQueryData<TeamInvitesResponse>(queryKey);

          queryClient.setQueryData<TeamInvitesResponse>(queryKey, (old) =>
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

        onSuccess: (_data, { teamId }) => {
          invalidateTeamInvites(teamId);
          toast.success('Invitation cancelled');
        },

        onError: (error, { teamId }, context) => {
          console.error('Failed to delete team invite', error);
          toast.failure('Failed to cancel invitation');

          if (context?.previousInvites) {
            queryClient.setQueryData(
              teamKeys.invites(teamId).queryKey,
              context.previousInvites
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
    mutationFn: async ({ teamId, userId }: RemoveUserFromTeamArgs) => {
      await throwOnErr(() =>
        authServiceClient.removeUserFromTeam(teamId, userId)
      );
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

type DeleteTeamArgs = { teamId: string };
type DeleteTeamContext = { previousTeams: Team[] | undefined };
type DeleteTeamCallbacks = MutationCallbacks<
  void,
  Error,
  DeleteTeamArgs,
  DeleteTeamContext
>;

export function useDeleteTeamMutation(callbacks?: DeleteTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ teamId }: DeleteTeamArgs) => {
      await throwOnErr(() => authServiceClient.deleteTeam(teamId));
    },

    ...withCallbacks<void, Error, DeleteTeamArgs, DeleteTeamContext>(
      {
        onMutate: async ({ teamId }) => {
          await queryClient.cancelQueries({
            queryKey: teamKeys.userTeams.queryKey,
          });

          const previousTeams = queryClient.getQueryData<Team[]>(
            teamKeys.userTeams.queryKey
          );

          queryClient.setQueryData<Team[]>(teamKeys.userTeams.queryKey, (old) =>
            old?.filter((team) => team.id !== teamId)
          );

          return { previousTeams };
        },

        onSuccess: () => {
          invalidateUserTeams();
          toast.success('Team deleted');
        },

        onError: (error, _args, context) => {
          console.error('Failed to delete team', error);
          toast.failure('Failed to delete team');

          if (context?.previousTeams) {
            queryClient.setQueryData(
              teamKeys.userTeams.queryKey,
              context.previousTeams
            );
          }
        },
      },
      callbacks
    ),
  }));
}
