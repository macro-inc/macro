import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { scheduledActionKeys } from './keys';

export function useRoutineQuery(id: Accessor<string>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.detail({ scheduleId: id() }).queryKey,
    queryFn: () => throwOnErr(() => scheduledActionClient.getRoutine(id())),
    refetchOnWindowFocus: 'always',
  }));
}
