import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { CreateTeamRequest } from '@service-auth/generated/schemas/createTeamRequest';
import type { PatchTeamRequest } from '@service-auth/generated/schemas/patchTeamRequest';
import type { Team } from '@service-auth/generated/schemas/team';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import { authKeys } from '../auth';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { teamKeys } from './keys';

export function useUserTeamsQuery() {
  return useQuery(() => ({
    queryKey: teamKeys.userTeams.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getUserTeams()),
  }));
}

export function useTeamQuery(teamId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: teamKeys.detail(teamId()).queryKey,
    queryFn: async () => await throwOnErr(() => authServiceClient.getTeam()),
    enabled: !!teamId(),
  }));
}

/** The current user's team (`getTeam()` always returns it). */
export function useCurrentTeamQuery() {
  return useQuery(() => ({
    queryKey: teamKeys.currentTeam.queryKey,
    queryFn: async () => await throwOnErr(() => authServiceClient.getTeam()),
  }));
}

/**
 * Reactive boolean: true iff the current user has admin or owner team
 * role. Drives admin-gated UI (e.g. the companies → hidden tab and the
 * detail-page Hide button).
 */
export function useIsTeamAdmin(): Accessor<boolean> {
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  return () => {
    const uid = userId();
    if (!uid) return false;
    const member = teamQuery.data?.members.find((m) => m.user_id === uid);
    return member?.role === TeamRole.admin || member?.role === TeamRole.owner;
  };
}

export function invalidateUserTeams() {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.userTeams.queryKey,
  });
}

export function invalidateTeam(teamId: string) {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.detail(teamId).queryKey,
  });
}

type CreateTeamArgs = CreateTeamRequest;
type CreateTeamCallbacks = MutationCallbacks<Team, Error, CreateTeamArgs>;

function _useCreateTeamMutation(callbacks?: CreateTeamCallbacks) {
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

type PatchTeamArgs = { teamId: string; request: PatchTeamRequest };
type PatchTeamCallbacks = MutationCallbacks<void, Error, PatchTeamArgs>;

export function usePatchTeamMutation(callbacks?: PatchTeamCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ request }: PatchTeamArgs) => {
      await throwOnErr(() => authServiceClient.patchTeam(request));
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
    mutationFn: async (_args: DeleteTeamArgs) => {
      await throwOnErr(() => authServiceClient.deleteTeam());
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

type CreateTeamWithInvitesArgs = {
  name: string;
  invites?: { email: string }[];
};
type CreateTeamWithInvitesContext = { previousTeams: Team[] | undefined };
type CreateTeamWithInvitesCallbacks = MutationCallbacks<
  Team,
  Error,
  CreateTeamWithInvitesArgs,
  CreateTeamWithInvitesContext
>;

export function useCreateTeamWithInvitesMutation(
  callbacks?: CreateTeamWithInvitesCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ name, invites }: CreateTeamWithInvitesArgs) => {
      const team = await throwOnErr(() =>
        authServiceClient.createTeam({ name })
      );

      if (invites && invites.length > 0) {
        await throwOnErr(() => authServiceClient.inviteToTeam({ invites }));
      }

      return team;
    },

    ...withCallbacks<
      Team,
      Error,
      CreateTeamWithInvitesArgs,
      CreateTeamWithInvitesContext
    >(
      {
        onMutate: async ({ name }) => {
          await queryClient.cancelQueries({
            queryKey: teamKeys.userTeams.queryKey,
          });

          const previousTeams = queryClient.getQueryData<Team[]>(
            teamKeys.userTeams.queryKey
          );

          const userInfo = queryClient.getQueryData<{ userId: string }>(
            authKeys.userInfo.queryKey
          );

          if (userInfo?.userId) {
            const optimisticTeam: Team = {
              id: `optimistic-${Date.now()}`,
              name,
              slug: 'MACRO', // optimisitc slug
              owner_id: userInfo.userId,
            };

            queryClient.setQueryData<Team[]>(
              teamKeys.userTeams.queryKey,
              (old) => (old ? [...old, optimisticTeam] : [optimisticTeam])
            );
          }

          return { previousTeams };
        },

        onSuccess: (_team, { invites }) => {
          invalidateUserTeams();
          const hasInvites = invites && invites.length > 0;
          toast.success(
            hasInvites ? 'Team created and invitations sent' : 'Team created'
          );
        },

        onError: (error, _args, context) => {
          console.error('Failed to create team', error);
          toast.failure('Failed to create team');

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
