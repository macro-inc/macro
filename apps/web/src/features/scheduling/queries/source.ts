import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { SchedulingSource } from '../context/scheduling-context';
import type { SchedulingProfile, SchedulingScope } from '../core/types';
import { schedulingKeys } from './keys';

export function createSchedulingSource(
  scope: Accessor<SchedulingScope>
): SchedulingSource {
  const profile = useQuery(() => ({
    queryKey: schedulingKeys.settings(scope().id).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings(scope().teamId)))
        .profile,
    retry: false,
  }));
  const bookings = useQuery(() => ({
    queryKey: schedulingKeys.bookings(scope().id).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.bookings(scope().teamId)))
        .bookings,
    retry: false,
  }));
  const save = useMutation(() => ({
    mutationFn: async ({
      next,
      owner,
    }: {
      next: SchedulingProfile;
      owner: SchedulingScope;
    }) =>
      (await throwOnErr(() => schedulingClient.save(next, owner.teamId)))
        .profile,
    onSuccess: (data, { owner }) => {
      queryClient.setQueryData(
        schedulingKeys.settings(owner.id).queryKey,
        data
      );
    },
  }));
  const reload = () => {
    void profile.refetch();
    void bookings.refetch();
  };
  return {
    profile: () => (profile.isSuccess ? profile.data : undefined),
    bookings: () => (bookings.isSuccess ? bookings.data : []),
    loading: () => profile.isPending || bookings.isPending,
    error: () =>
      profile.isError || bookings.isError
        ? 'Calendar scheduling could not be loaded. Check your connection and try again.'
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
      return queryClient.fetchQuery({
        queryKey: schedulingKeys.insights(owner.id, from, to).queryKey,
        queryFn: async () =>
          (
            await throwOnErr(() =>
              schedulingClient.bookings(owner.teamId, { from, to })
            )
          ).bookings,
        staleTime: 0,
        retry: false,
      });
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
  return useMutation(() => ({
    mutationFn: (id: string) => throwOnErr(() => schedulingClient.manage(id)),
  }));
}
