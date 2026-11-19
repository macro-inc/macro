import { throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
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

/** Read for approval. A newer revision already in the cache makes it stale. */
export async function readFreshRoutine(id: string, parent: TraceContext) {
  const fresh = await parent.run(() =>
    throwOnErr(() =>
      scheduledActionClient.getRoutine(id, { cache: 'no-store' })
    )
  );
  const queryKey = scheduledActionKeys.detail({ scheduleId: id }).queryKey;
  const hasNewerRevision = () => {
    const cached = queryClient.getQueryData<ScheduledAction>(queryKey);
    return (
      !!cached && cached.configuration_revision > fresh.configuration_revision
    );
  };
  if (hasNewerRevision()) return;
  await queryClient.cancelQueries({ queryKey, exact: true });
  if (hasNewerRevision()) return;
  queryClient.setQueryData(queryKey, fresh);
  return fresh;
}
