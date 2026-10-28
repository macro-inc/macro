import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { JoinTeamByInviteLinkResponse } from '@service-auth/generated/schemas/joinTeamByInviteLinkResponse';
import type { TeamInviteLinkResponse } from '@service-auth/generated/schemas/teamInviteLinkResponse';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { teamKeys } from './keys';
import { invalidateUserTeams } from './teams';

function fetchTeamInviteLink() {
  return throwOnErr(() => authServiceClient.getTeamInviteLink());
}

const teamInviteLinkQueryOptions = (teamId: string, enabled: boolean) =>
  queryOptions({
    queryKey: teamKeys.inviteLink(teamId).queryKey,
    queryFn: fetchTeamInviteLink,
    enabled: !!teamId && enabled,
  });

/** The team's invite link token, or null when the team has none. */
export function useTeamInviteLinkQuery(
  teamId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => teamInviteLinkQueryOptions(teamId(), enabled()));
}

function setTeamInviteLink(teamId: string, token: string | null) {
  queryClient.setQueryData<TeamInviteLinkResponse>(
    teamKeys.inviteLink(teamId).queryKey,
    { token }
  );
}

type TeamInviteLinkArgs = { teamId: string };

/** Creates the team's invite link, or replaces it with a new one. */
export function useCreateTeamInviteLinkMutation(
  callbacks?: MutationCallbacks<string, Error, TeamInviteLinkArgs>
) {
  return useMutation(() => ({
    mutationFn: async (_args: TeamInviteLinkArgs) =>
      (await throwOnErr(() => authServiceClient.createTeamInviteLink())).token,

    ...withCallbacks<string, Error, TeamInviteLinkArgs>(
      {
        onSuccess: (token, { teamId }) => setTeamInviteLink(teamId, token),
        onError: (error) => {
          console.error('Failed to create team invite link', error);
          toast.failure('Failed to create invite link');
        },
      },
      callbacks
    ),
  }));
}

/** Turns off the team's invite link. */
export function useDeleteTeamInviteLinkMutation(
  callbacks?: MutationCallbacks<void, Error, TeamInviteLinkArgs>
) {
  return useMutation(() => ({
    mutationFn: async (_args: TeamInviteLinkArgs) => {
      await throwOnErr(() => authServiceClient.deleteTeamInviteLink());
    },

    ...withCallbacks<void, Error, TeamInviteLinkArgs>(
      {
        onSuccess: (_data, { teamId }) => {
          setTeamInviteLink(teamId, null);
          toast.success('Invite link turned off');
        },
        onError: (error) => {
          console.error('Failed to turn off team invite link', error);
          toast.failure('Failed to turn off invite link');
        },
      },
      callbacks
    ),
  }));
}

function fetchTeamByInviteLink(token: string) {
  return throwOnErr(() => authServiceClient.getTeamByInviteLink(token));
}

const teamByInviteLinkQueryOptions = (token: string, enabled: boolean) =>
  queryOptions({
    queryKey: teamKeys.inviteLinkTeam(token).queryKey,
    queryFn: () => fetchTeamByInviteLink(token),
    enabled: !!token && enabled,
    // A missing link stays missing; don't retry the 404.
    retry: false,
  });

/** The team an invite link joins. */
export function useTeamByInviteLinkQuery(
  token: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => teamByInviteLinkQueryOptions(token(), enabled()));
}

/** Joins the team an invite link belongs to. */
export function useJoinTeamByInviteLinkMutation(
  callbacks?: MutationCallbacks<
    JoinTeamByInviteLinkResponse,
    Error,
    { token: string }
  >
) {
  return useMutation(() => ({
    mutationFn: ({ token }: { token: string }) =>
      throwOnErr(() => authServiceClient.joinTeamByInviteLink(token)),

    ...withCallbacks<JoinTeamByInviteLinkResponse, Error, { token: string }>(
      { onSuccess: () => invalidateUserTeams() },
      callbacks
    ),
  }));
}
