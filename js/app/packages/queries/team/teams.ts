import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import type { CreateTeamRequest } from '@service-auth/generated/schemas/createTeamRequest';
import type { PatchTeamRequest } from '@service-auth/generated/schemas/patchTeamRequest';
import type { Team } from '@service-auth/generated/schemas/team';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

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
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getTeam(teamId())),
    enabled: !!teamId(),
  }));
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
