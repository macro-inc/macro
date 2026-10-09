import type { Query, QueryKey } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { calendarKeys } from './keys';
import { calendarTeamKeys } from './team-keys';

/** A missed poll may retain data briefly, but a hung request cannot retain it. */
export const TEAM_CALENDAR_MAX_DATA_AGE_MS = 60_000;

function isTeamCalendarKey(key: QueryKey) {
  return (
    key[0] === calendarTeamKeys._def[0] ||
    (key[0] === calendarKeys.teamOutOfOffice._def[0] &&
      key[1] === calendarKeys.teamOutOfOffice._def[1])
  );
}

let expiryInstalled = false;

/** Start with the first team observer, avoiding work in unrelated app views. */
export function ensureTeamCalendarExpiry() {
  if (expiryInstalled) return;
  expiryInstalled = true;
  const expirations = new Map<
    Query,
    { deadline: number; timer: ReturnType<typeof setTimeout> }
  >();
  queryClient.getQueryCache().subscribe((event) => {
    const query = event.query;
    if (!isTeamCalendarKey(query.queryKey)) return;
    if (!['added', 'updated', 'removed'].includes(event.type)) return;
    const previous = expirations.get(query);
    if (previous) clearTimeout(previous.timer);
    expirations.delete(query);
    if (event.type === 'removed') return;
    const { data, dataUpdatedAt, fetchStatus } = query.state;
    if (data === undefined && fetchStatus === 'idle') return;
    // Fetch/invalidation notifications do not extend an existing lease. Bound
    // initial requests too, so a delayed response cannot install old permissions.
    const deadline =
      data !== undefined
        ? dataUpdatedAt + TEAM_CALENDAR_MAX_DATA_AGE_MS
        : (previous?.deadline ?? Date.now() + TEAM_CALENDAR_MAX_DATA_AGE_MS);
    const timer = setTimeout(
      () => {
        expirations.delete(query);
        // Query.reset cancels its retryer before notifying active observers. A
        // late response cannot restore the expired payload or detached selection.
        query.reset();
      },
      Math.max(0, deadline - Date.now())
    );
    expirations.set(query, { deadline, timer });
  });
}

/** Session replacement must clear active observers before any new auth fetch. */
export function resetTeamCalendarSession() {
  for (const query of queryClient.getQueryCache().findAll({
    predicate: (query) => isTeamCalendarKey(query.queryKey),
  })) {
    // Do not refetch here: the caller controls the new session's request order.
    query.reset();
  }
}

/** Clear payloads first: a revoked title must disappear even if refetch fails. */
export async function resetTeamCalendarQueries() {
  await Promise.all([
    queryClient.resetQueries({ queryKey: calendarTeamKeys._def }),
    queryClient.resetQueries({ queryKey: calendarKeys.teamOutOfOffice._def }),
  ]);
}

export function clearTeamCalendarQueries() {
  resetTeamCalendarSession();
  queryClient.removeQueries({ queryKey: calendarTeamKeys._def });
  queryClient.removeQueries({ queryKey: calendarKeys.teamOutOfOffice._def });
}

/** Calendar selections are detached objects, including OOO agenda selections. */
export function subscribeToTeamCalendarReset(onReset: () => void) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (
      isTeamCalendarKey(event.query.queryKey) &&
      event.type === 'updated' &&
      ((event.action.type === 'setState' &&
        event.query.state.data === undefined) ||
        event.action.type === 'error' ||
        event.query.state.fetchStatus === 'paused')
    )
      onReset();
  });
}
