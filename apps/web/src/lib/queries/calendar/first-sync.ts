import { usePending } from '@app/observability/flow';
import { throwOnErr } from '@core/util/result';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { storageServiceClient } from '@service-storage/client';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { assertQueryAccount, type QueryAccount } from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import { useVisibleCalendarsQuery } from './calendars';
import { calendarKeys } from './keys';
import { createCalendarOccurrenceQueryRange } from './occurrences';

function calendarFirstSyncOptions(
  owner: QueryAccount | undefined,
  linkIds: readonly string[]
) {
  return {
    queryKey: calendarKeys.firstSync(owner?.userId, owner?.session, linkIds)
      .queryKey,
    enabled: !!owner && linkIds.length > 0,
    // The invitation card and its open composer share the same sample.
    staleTime: 30_000,
    // Only the response's ingestion state is needed. Ask for one occurrence
    // in a small viewport so the same request works with either calendar store.
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      assertQueryAccount(owner);
      const now = new Date();
      const range = createCalendarOccurrenceQueryRange(
        now,
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      );
      const result = await throwOnErr(() =>
        storageServiceClient.listCalendarOccurrences({
          ...range,
          end: new Date(now.getTime() + 1).toISOString(),
          limit: 1,
          signal,
        })
      );
      assertQueryAccount(owner);
      return result.syncStatus;
    },
  };
}

/** True while a connected inbox is importing and has yet to list a calendar. */
export function useCalendarFirstSync(enabled: Accessor<boolean>) {
  const account = useQueryAccount();
  const links = useEmailLinksQuery(enabled);
  const calendars = useVisibleCalendarsQuery(() => ({ enabled: enabled() }));
  const awaitingDiscovery = createMemo(() => {
    if (
      !enabled() ||
      !queryReadyGate(links) ||
      !queryReadyGate(calendars) ||
      calendars.isPlaceholderData ||
      calendars.data.some((calendar) => calendar.isWritable)
    ) {
      return [];
    }
    const discoveredLinks = new Set(
      calendars.data.map((calendar) => calendar.emailLinkId)
    );
    // A newly linked inbox must not reuse the previous grants' status.
    return links.data.links
      .filter(
        (link) =>
          link.is_sync_active &&
          !link.needs_reauth &&
          !link.needs_calendar_permission &&
          !discoveredLinks.has(link.id)
      )
      .map((link) => link.id)
      .sort();
  });
  const status = useQuery(() =>
    calendarFirstSyncOptions(account(), awaitingDiscovery())
  );
  usePending('calendar.first_sync.status', () => status.isLoading);

  return () =>
    !!account() &&
    awaitingDiscovery().length > 0 &&
    queryReadyGate(status) &&
    status.data === CalendarSyncStatus.syncing;
}
