import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { queryClient } from '@queries/client';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { makeEventListener } from '@solid-primitives/event-listener';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { calendarKeys } from '../keys';
import { createCalendarOccurrenceQueryRange } from '../occurrences';
import { runCalendarBackfill } from './backfill';
import { useGraphqlCalendarHost } from './flag';
import { mapCalendarSyncStatus } from './map';
import {
  fetchCalendarOccurrencePage,
  latestCalendarSyncStatus,
  recordCalendarSyncStatus,
} from './range';
import {
  activeCalendarSyncController,
  CalendarSyncController,
  setActiveCalendarSyncController,
} from './sync-controller';

const SYNCING_POLL_MS = 60_000;
const DAY_MS = 86_400_000;

/** Re-reads ingestion state while syncing; covered views would never ask. */
async function refreshSyncStatus(): Promise<void> {
  const now = Date.now();
  const range = createCalendarOccurrenceQueryRange(
    new Date(now),
    new Date(now + DAY_MS)
  );
  const page = await fetchCalendarOccurrencePage({ ...range, first: 1 });
  const status = mapCalendarSyncStatus(page.syncStatus);
  if (status === latestCalendarSyncStatus()) return;
  recordCalendarSyncStatus(status);
  await queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}

/**
 * Keeps the cached calendar current while calendar reads use the cache:
 * pokes (`refresh_calendar`), reconnects, coming online, becoming visible,
 * and cache generation changes run a delta, with a slow poll while the
 * server is still syncing. The cross-tab leader also widens coverage in the
 * background.
 */
export function useCalendarCache(): void {
  const host = useGraphqlCalendarHost();
  const isLeader = createTabLeaderSignal('graphql-calendar-backfill:v1');
  const [generation, setGeneration] = createSignal(0);

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost) return;
    const controller = new CalendarSyncController(cacheHost);
    setActiveCalendarSyncController(controller);
    controller.markStale('start');
    const unsubscribeReconnect = subscribeGraphqlSoupReconnected(() =>
      controller.markStale('reconnect')
    );
    const unsubscribeGeneration = cacheHost.onCacheGenerationChanged(() => {
      controller.markStale('generation');
      setGeneration((value) => value + 1);
    });
    const removeOnline = makeEventListener(window, 'online', () =>
      controller.markStale('online')
    );
    const removeVisibility = makeEventListener(
      document,
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          controller.markStale('visible');
        }
      }
    );
    const poll = setInterval(() => {
      if (latestCalendarSyncStatus() !== CalendarSyncStatus.syncing) return;
      controller.markStale('syncing');
      refreshSyncStatus().catch((error) => {
        console.warn('Calendar sync status refresh failed', error);
      });
    }, SYNCING_POLL_MS);
    onCleanup(() => {
      clearInterval(poll);
      removeVisibility();
      removeOnline();
      unsubscribeGeneration();
      unsubscribeReconnect();
      controller.dispose();
      if (activeCalendarSyncController() === controller) {
        setActiveCalendarSyncController(undefined);
      }
    });
  });

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !isLeader()) return;
    generation();
    const abort = new AbortController();
    runCalendarBackfill(cacheHost, { signal: abort.signal }).catch((error) => {
      if (!abort.signal.aborted) {
        console.warn('Calendar backfill stopped', error);
      }
    });
    onCleanup(() => abort.abort());
  });
}
