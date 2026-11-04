import { queryClient } from '@queries/client';
import type { BookingLinkResult } from '@service-cognition/generated/tools/types';
import type { Query } from '@tanstack/solid-query';
import type { SchedulingProfile } from '../core/types';
import { schedulingKeys } from './keys';

type PendingRefresh = {
  profileId: string;
  revision: number;
  promise: Promise<void>;
};
const pendingRefreshes: PendingRefresh[] = [];

/** Refresh stale or still-unknown profiles after an agent commits a link. */
export function refreshBookingLinkResult(
  result: Pick<BookingLinkResult, 'profileId' | 'revision'>
) {
  const pending = pendingRefreshes.find(
    (refresh) =>
      refresh.profileId === result.profileId &&
      refresh.revision >= result.revision
  );
  if (pending) return pending.promise;

  // Snapshot the affected queries before cancellation can restore older cache data.
  const affected = queryClient
    .getQueryCache()
    .findAll({ queryKey: schedulingKeys.settings._def })
    .filter((query) => {
      const profile = query.state.data as SchedulingProfile | undefined;
      // Initial reads have no owner identity; in-flight reads can predate this result.
      return (
        !profile ||
        (profile.id === result.profileId &&
          (profile.revision < result.revision ||
            query.state.fetchStatus === 'fetching'))
      );
    })
    .map((query) => query.queryHash);
  if (!affected.length) return Promise.resolve();
  const filters = {
    queryKey: schedulingKeys.settings._def,
    predicate: (query: Query) => affected.includes(query.queryHash),
  };
  const promise = (async () => {
    // Explicit cancellation also covers initial reads, which invalidateQueries reuses.
    await queryClient.cancelQueries(filters);
    await queryClient.invalidateQueries(filters);
  })();
  // Repeated render/stream notifications share the same refresh.
  const refresh = {
    profileId: result.profileId,
    revision: result.revision,
    promise,
  };
  pendingRefreshes.push(refresh);
  return promise.finally(() => {
    const index = pendingRefreshes.indexOf(refresh);
    if (index !== -1) pendingRefreshes.splice(index, 1);
  });
}
