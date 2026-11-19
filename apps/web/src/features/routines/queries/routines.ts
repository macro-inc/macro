import { throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { scheduledActionKeys } from './keys';
import { routineQueryTrace } from './routine-trace';

export function routineQueryOptions(id: string) {
  return queryOptions({
    queryKey: scheduledActionKeys.detail({ scheduleId: id }).queryKey,
    behavior: routineQueryTrace,
    queryFn: () => throwOnErr(() => scheduledActionClient.getRoutine(id)),
    refetchOnWindowFocus: 'always',
  });
}

export function useRoutineQuery(id: Accessor<string>) {
  return useQuery(() => routineQueryOptions(id()));
}

/** Approval needs a new server read even when the editor has a cached task. */
export async function readFreshRoutine(id: string, parent: TraceContext) {
  const fresh = await parent.run(() =>
    throwOnErr(() =>
      scheduledActionClient.getRoutine(id, { cache: 'no-store' })
    )
  );
  const queryKey = scheduledActionKeys.detail({ scheduleId: id }).queryKey;
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, fresh);
  return fresh;
}
