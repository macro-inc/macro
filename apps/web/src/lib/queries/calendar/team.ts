import type { CalendarSharing } from '@app/features/calendar-team/core/model';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { TeamCalendarSharingBody } from '@service-calendar/generated/schemas/teamCalendarSharingBody';
import { emailClient } from '@service-email/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import {
  type CachedQuerySnapshot,
  isLastPendingSave,
  replaceCachedQuery,
} from './setting-saves';
import { ensureTeamCalendarExpiry } from './team-cache';
import {
  type CalendarTeamIdentity,
  calendarTeamKeys,
  calendarTeamMutationKeys,
} from './team-keys';

const REFRESH_INTERVAL = 30_000;
const freshness = {
  staleTime: 0,
  gcTime: 0,
  refetchInterval: REFRESH_INTERVAL,
  refetchOnWindowFocus: true,
  refetchOnReconnect: 'always' as const,
};

function calendarTeamIdentityQueryOptions(
  userId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: calendarTeamKeys.identity(userId ?? '').queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.getTeam()),
    enabled: Boolean(userId) && enabled,
    ...freshness,
  });
}

/** A viewer-scoped roster read avoids the legacy current-team singleton cache. */
export function useCalendarTeamIdentityQuery(
  userId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  ensureTeamCalendarExpiry();
  return useQuery(() => calendarTeamIdentityQueryOptions(userId(), enabled()));
}

function teamCalendarSharingQueryOptions(
  identity: CalendarTeamIdentity | undefined
) {
  return queryOptions({
    queryKey: calendarTeamKeys.sharing(identity).queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() => emailClient.getTeamCalendarSharing(signal)),
    enabled: identity !== undefined,
    ...freshness,
  });
}

export function useTeamCalendarSharingQuery(
  identity: Accessor<CalendarTeamIdentity | undefined>
) {
  return useQuery(() => teamCalendarSharingQueryOptions(identity()));
}

const teamSharingMutationKey = calendarTeamMutationKeys.sharing;

interface TeamSharingChange {
  identity: CalendarTeamIdentity;
  sharing: CalendarSharing;
}

const teamSharingMutationOptions = {
  mutationKey: teamSharingMutationKey,
  scope: { id: 'calendar-team-sharing' },
  mutationFn: ({ sharing }: TeamSharingChange) =>
    throwOnErr(() => emailClient.setTeamCalendarSharing({ sharing })),
  onMutate: ({ identity, sharing }: TeamSharingChange) =>
    replaceCachedQuery<TeamCalendarSharingBody>(
      calendarTeamKeys.sharing(identity).queryKey,
      () => ({ sharing })
    ),
  onError: (
    _error: unknown,
    { identity }: TeamSharingChange,
    snapshot: CachedQuerySnapshot<TeamCalendarSharingBody> | undefined
  ) => {
    if (snapshot?.previous && isLastPendingSave(teamSharingMutationKey))
      queryClient.setQueryData(
        calendarTeamKeys.sharing(identity).queryKey,
        snapshot.previous
      );
  },
  onSettled: (
    _data: unknown,
    _error: unknown,
    { identity }: TeamSharingChange
  ) =>
    isLastPendingSave(teamSharingMutationKey)
      ? queryClient.invalidateQueries({
          queryKey: calendarTeamKeys.sharing(identity).queryKey,
        })
      : undefined,
};

/** The viewer's own sharing never changes what they can read, so nothing else resets. */
export function useSetTeamCalendarSharingMutation() {
  return useMutation(() => teamSharingMutationOptions);
}
