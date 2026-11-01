import { getDisplayNameParts, type MacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { SchedulingSource } from '../context/scheduling-context';
import {
  newDefaultBookingLink,
  newSchedule,
  type SchedulingProfile,
  type SchedulingScope,
} from '../core/types';
import { schedulingKeys } from './keys';

function schedulingProfileQueryOptions(
  scopeId: string,
  teamId: string | undefined,
  userId?: string
) {
  return queryOptions({
    queryKey: schedulingKeys.settings(scopeId).queryKey,
    queryFn: async () => {
      const { profile } = await throwOnErr(() =>
        schedulingClient.settings(teamId)
      );
      if (!teamId && userId) {
        const updated = await createDefaultBookingLinkIfNeeded(profile, userId);
        if (updated) return updated;
      }
      return profile;
    },
    retry: false,
  });
}

function schedulingBookingsQueryOptions(
  scopeId: string,
  teamId: string | undefined,
  from: string,
  to: string
) {
  return queryOptions({
    queryKey: schedulingKeys.bookings(scopeId, from, to).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.bookings(teamId, { from, to })))
        .bookings,
    retry: false,
  });
}

function schedulingInsightsQueryOptions(
  scopeId: string,
  teamId: string | undefined,
  from: string,
  to: string
) {
  return queryOptions({
    queryKey: schedulingKeys.insights(scopeId, from, to).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.bookings(teamId, { from, to })))
        .bookings,
    retry: false,
    staleTime: 0,
  });
}

const saveSchedulingProfileOptions = {
  mutationFn: async ({
    next,
    owner,
  }: {
    next: SchedulingProfile;
    owner: SchedulingScope;
  }) =>
    (await throwOnErr(() => schedulingClient.save(next, owner.teamId))).profile,
  onSuccess: (
    data: SchedulingProfile,
    { owner }: { owner: SchedulingScope }
  ) => {
    queryClient.setQueryData(schedulingKeys.settings(owner.id).queryKey, data);
  },
};

const manageBookingOptions = {
  mutationFn: (id: string) => throwOnErr(() => schedulingClient.manage(id)),
};

export function useSchedulingProfileQuery(scope: Accessor<SchedulingScope>) {
  return useQuery(() =>
    schedulingProfileQueryOptions(scope().id, scope().teamId)
  );
}

export function createSchedulingSource(
  scope: Accessor<SchedulingScope>,
  range: Accessor<{ from: string; to: string }>,
  loadBookings: Accessor<boolean> = () => true
): SchedulingSource {
  const profile = useSchedulingProfileQuery(scope);
  const bookings = useQuery(() => ({
    ...schedulingBookingsQueryOptions(
      scope().id,
      scope().teamId,
      range().from,
      range().to
    ),
    enabled: loadBookings(),
  }));
  const save = useMutation(() => saveSchedulingProfileOptions);
  const reload = () => {
    fireAndForget(profile.refetch(), 'scheduling');
    if (loadBookings()) fireAndForget(bookings.refetch(), 'scheduling');
  };
  return {
    profile: () => (profile.isSuccess ? profile.data : undefined),
    bookings: () => (bookings.isSuccess ? bookings.data : []),
    loading: () => profile.isPending || (loadBookings() && bookings.isPending),
    error: () =>
      profile.isError || (loadBookings() && bookings.isError)
        ? profile.isError
          ? 'Calendar scheduling could not be loaded. Check your connection and try again.'
          : 'Bookings could not be loaded. Try a shorter date range or check your connection.'
        : undefined,
    saving: () => save.isPending,
    save: async (next) => {
      await save.mutateAsync({ next, owner: scope() });
    },
    approve: async (id) => {
      await throwOnErr(() => schedulingClient.approve(id));
      await bookings.refetch();
    },
    cancel: async (id) => {
      await throwOnErr(() => schedulingClient.cancel(id));
      await bookings.refetch();
    },
    loadInsights: (from, to) => {
      const owner = scope();
      return queryClient.fetchQuery(
        schedulingInsightsQueryOptions(owner.id, owner.teamId, from, to)
      );
    },
    setAttendance: async (id, attendance) => {
      await throwOnErr(() => schedulingClient.setAttendance(id, attendance));
      await bookings.refetch();
      await queryClient.invalidateQueries({
        queryKey: schedulingKeys.insights._def,
      });
    },
    reload,
  };
}

export function useManageBookingMutation() {
  return useMutation(() => manageBookingOptions);
}

async function createDefaultBookingLinkIfNeeded(
  profile: SchedulingProfile,
  userId: string
): Promise<SchedulingProfile | null> {
  if (profile.revision !== 0 || profile.eventTypes.length > 0) {
    return null;
  }

  const { firstName } = getDisplayNameParts(userId as MacroId);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const schedule = newSchedule(timeZone);
  const bookingLink = newDefaultBookingLink(schedule.id, userId, firstName);

  const updatedProfile: SchedulingProfile = {
    ...profile,
    schedules: [schedule],
    defaultScheduleId: schedule.id,
    eventTypes: [bookingLink],
  };

  try {
    const result = await throwOnErr(() =>
      schedulingClient.save(updatedProfile, undefined)
    );
    return result.profile;
  } catch {
    return null;
  }
}

export function useSchedulingProfileWithAutoSetupQuery(
  scope: Accessor<SchedulingScope>,
  userId: Accessor<string>
) {
  return useQuery(() =>
    schedulingProfileQueryOptions(scope().id, scope().teamId, userId())
  );
}
