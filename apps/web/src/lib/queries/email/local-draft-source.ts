import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type {
  FieldFilters,
  QueryState,
} from '@app/features/next-soup/filters/filter-store/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { authKeys } from '../auth/keys';
import { queryClient } from '../client';
import { listLocalDrafts, localDraftStore } from './local-drafts';

export { localDraftEntities } from './local-draft-entities';

/** Account-scoped local data source; notifications are invalidations, never the truth. */
export function createLocalDraftSource(enabled: Accessor<boolean>) {
  const [drafts, setDrafts] = createSignal<LocalDraft[]>([]);
  const [ready, setReady] = createSignal(false);
  let generation = 0;
  let disposed = false;
  const refresh = async () => {
    const request = ++generation;
    if (!enabled()) {
      setDrafts([]);
      setReady(true);
      return;
    }
    const span = Telemetry.span('email.drafts.discover');
    try {
      const entries = await listLocalDrafts();
      span.setAttr('email.draft_count', entries.length);
      if (!disposed && request === generation)
        setDrafts(entries.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      span.error('Unable to read local email drafts');
      if (!disposed && request === generation) setDrafts([]);
    } finally {
      span.end();
      if (!disposed && request === generation) setReady(true);
    }
  };
  // Notifications can arrive mid-disposal (an observer removed by navigation),
  // where reading `enabled` re-runs the disposing owner's stale memos.
  const scheduleRefresh = () =>
    queueMicrotask(() => {
      if (!disposed) fireAndForget(refresh(), 'email-local-drafts');
    });
  const unsubscribe = localDraftStore.subscribe(scheduleRefresh);
  const auth = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === JSON.stringify(authKeys.userInfo.queryKey))
      scheduleRefresh();
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
    auth();
  });
  createEffect(
    on(enabled, () => {
      fireAndForget(refresh(), 'email-local-drafts');
    })
  );
  return { drafts: () => (enabled() ? drafts() : []), ready };
}

/** Server email filters also apply to recovery rows, which never visit that server. */
export function localDraftMatchesFilters(
  draft: LocalDraft,
  query: QueryState
): boolean {
  if (query.emailView === 'sent') return false;
  const matches = (filters: FieldFilters, exclude: boolean) => {
    const fields: [string[] | undefined, (string | undefined)[]][] = [
      [filters.emailLinkId, [draft.inboxId]],
      [filters.threadId, [draft.threadId, draft.serverThreadId]],
      [filters.emailSender, [draft.senderEmail]],
      [filters.emailProjectId, []],
    ];
    for (const [selected, actual] of fields) {
      if (!selected?.length) continue;
      const match = actual.some(
        (value) => value !== undefined && selected.includes(value)
      );
      if (exclude ? match : !match) return false;
    }
    const values: [boolean | undefined, boolean][] = [
      [filters.emailSeen, true],
      [filters.emailDone, false],
      [filters.emailImportance, true],
      [filters.emailCalendarOnly, false],
    ];
    for (const [selected, actual] of values) {
      if (
        selected !== undefined &&
        (exclude ? selected === actual : selected !== actual)
      )
        return false;
    }
    if (filters.emailShared === 'only' && !exclude) return false;
    const range = filters.emailUpdatedAt;
    if (range) {
      const time = draft.updatedAt;
      const match = buildMatch(time, range);
      if (exclude ? match : !match) return false;
    }
    return true;

    function buildMatch(time: number, rangeValue: NonNullable<typeof range>) {
      return (
        (!rangeValue.gt || time > Date.parse(rangeValue.gt)) &&
        (!rangeValue.gte || time >= Date.parse(rangeValue.gte)) &&
        (!rangeValue.lt || time < Date.parse(rangeValue.lt)) &&
        (!rangeValue.lte || time <= Date.parse(rangeValue.lte))
      );
    }
  };
  return matches(query.include, false) && matches(query.exclude, true);
}
