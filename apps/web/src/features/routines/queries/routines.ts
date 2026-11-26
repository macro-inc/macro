import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { scheduledActionKeys } from './keys';

/**
 * The server reads a routine only to its owner and answers anyone else 401 or
 * 404, so those are final; other failures get one retry.
 */
function retryRoutineRead(failureCount: number, error: Error) {
  const refused = ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some((code) =>
    thrownResultErrorHasCode(error, code)
  );
  return !refused && failureCount < 1;
}

export function routineQueryOptions(id: string) {
  return queryOptions({
    queryKey: scheduledActionKeys.detail({ scheduleId: id }).queryKey,
    queryFn: () => throwOnErr(() => scheduledActionClient.getRoutine(id)),
    refetchOnWindowFocus: 'always',
    retry: retryRoutineRead,
  });
}

export function useRoutineQuery(id: Accessor<string>) {
  return useQuery(() => routineQueryOptions(id()));
}
