import { throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { readSchedule } from './claims';
import { scheduledActionKeys } from './keys';
import { routineQueryTrace } from './routine-trace';

export function routineQueryOptions(id: string) {
  return queryOptions({
    queryKey: scheduledActionKeys.detail({ scheduleId: id }).queryKey,
    behavior: routineQueryTrace,
    queryFn: () =>
      readSchedule(() =>
        throwOnErr(() => scheduledActionClient.getRoutine(id))
      ),
    refetchOnWindowFocus: 'always',
  });
}

export function useRoutineQuery(id: Accessor<string>) {
  return useQuery(() => routineQueryOptions(id()));
}

export function hasNewerRoutineRevision(id: string, revision: number) {
  const detail = queryClient.getQueryData<ScheduledAction>(
    scheduledActionKeys.detail({ scheduleId: id }).queryKey
  );
  if (detail && detail.configuration_revision > revision) return true;

  // The editor falls back to the list before detail has loaded.
  const list = queryClient.getQueryData<ScheduledAction[]>(
    scheduledActionKeys.list.queryKey
  );
  return (
    list?.some(
      (item) => item.id === id && item.configuration_revision > revision
    ) ?? false
  );
}

/** Read for approval. Either cache the editor reads can make it stale. */
export async function readFreshRoutine(id: string, parent: TraceContext) {
  const fresh = await parent.run(() =>
    readSchedule(() =>
      throwOnErr(() =>
        scheduledActionClient.getRoutine(id, { cache: 'no-store' })
      )
    )
  );
  const queryKey = scheduledActionKeys.detail({ scheduleId: id }).queryKey;
  if (hasNewerRoutineRevision(id, fresh.configuration_revision)) return;
  await queryClient.cancelQueries({ queryKey, exact: true });
  if (hasNewerRoutineRevision(id, fresh.configuration_revision)) return;
  queryClient.setQueryData(queryKey, fresh);
  return fresh;
}
