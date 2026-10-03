import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { scheduledActionKeys } from './keys';

export function useTeamRoutinesQuery(enabled: Accessor<boolean> = () => true) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.team.queryKey,
    queryFn: () => throwOnErr(() => scheduledActionClient.listTeamRoutines()),
    enabled: enabled(),
    refetchOnWindowFocus: 'always',
  }));
}
export function useRoutineQuery(id: Accessor<string>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.detail({ scheduleId: id() }).queryKey,
    queryFn: () => throwOnErr(() => scheduledActionClient.getRoutine(id())),
    refetchOnWindowFocus: 'always',
  }));
}
export function useShareRoutineMutation() {
  return useMutation(() => ({
    mutationFn: (args: { id: string; teamId: string | null }) =>
      throwOnErr(() =>
        scheduledActionClient.shareRoutine(args.id, args.teamId)
      ),
    onSuccess: async (routine) => {
      if (routine.id)
        queryClient.setQueryData(
          scheduledActionKeys.detail({ scheduleId: routine.id }).queryKey,
          routine
        );
      await queryClient.invalidateQueries({
        queryKey: scheduledActionKeys.team.queryKey,
      });
    },
  }));
}
