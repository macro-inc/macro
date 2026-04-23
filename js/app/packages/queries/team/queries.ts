import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { teamKeys } from './keys';

export function useUserTeamsQuery() {
  return useQuery(() => ({
    queryKey: teamKeys.userTeams.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getUserTeams()),
  }));
}

export function useUserInvitesQuery() {
  return useQuery(() => ({
    queryKey: teamKeys.userInvites.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getUserInvites()),
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

export function useTeamInvitesQuery(teamId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: teamKeys.invites(teamId()).queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getTeamInvites(teamId())),
    enabled: !!teamId(),
  }));
}

export function invalidateUserTeams() {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.userTeams.queryKey,
  });
}

export function invalidateUserInvites() {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.userInvites.queryKey,
  });
}

export function invalidateTeam(teamId: string) {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.detail(teamId).queryKey,
  });
}

export function invalidateTeamInvites(teamId: string) {
  return queryClient.invalidateQueries({
    queryKey: teamKeys.invites(teamId).queryKey,
  });
}
