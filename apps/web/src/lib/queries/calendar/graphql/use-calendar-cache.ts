import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { queryClient } from '@queries/client';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { makeEventListener } from '@solid-primitives/event-listener';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { calendarKeys } from '../keys';
import { createCalendarOccurrenceQueryRange } from '../occurrences';
import { runCalendarBackfill } from './backfill';
import { useGraphqlCalendarHost } from './flag';
import { mapCalendarSyncStatus } from './map';
import { trackCalendarCreateSettlements } from './mutations';
import {
  beginCalendarSyncStatusSample,
  fetchCalendarOccurrencePage,
  latestCalendarSyncStatus,
  recordCalendarSyncStatus,
} from './range';
import {
  activeCalendarSyncController,
  type CalendarStaleReason,
  CalendarSyncController,
  setActiveCalendarSyncController,
} from './sync-controller';

const SYNCING_POLL_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Reads the server's viewer-wide ingestion state. Viewports already in the
 * cache fetch nothing, so they never report it themselves. A read that ends
 * after its controller was retired (sign-out, another account) is dropped.
 */
async function refreshSyncStatus(owner: CalendarSyncController): Promise<void> {
  const now = Date.now();
  const range = createCalendarOccurrenceQueryRange(
    new Date(now),
    new Date(now + DAY_MS)
  );
  const sample = beginCalendarSyncStatusSample();
  const page = await fetchCalendarOccurrencePage({ ...range, first: 1 });
  const status = mapCalendarSyncStatus(page.syncStatus);
  if (activeCalendarSyncController() !== owner) return;
  const previous = latestCalendarSyncStatus();
  if (!recordCalendarSyncStatus(status, sample) || status === previous) return;
  await queryClient.invalidateQueries({
    queryKey: calendarKeys.occurrences._def,
  });
}

function startSyncStatusRefresh(owner: CalendarSyncController): void {
  refreshSyncStatus(owner).catch((error) => {
    console.warn('Calendar sync status refresh failed', error);
  });
}

/**
 * Keeps the cached calendar current while calendar reads use the cache:
 * pokes (`refresh_calendar`), reconnects, coming online, becoming visible,
 * and cache generation changes run a delta, with a slow poll while the
 * server is still syncing. Starting, and each of those except pokes, also
 * reads the server's sync status, so a reload whose viewports are all cached
 * still learns that a first import is running. The cross-tab leader also
 * widens coverage in the background.
 */
/** Keeps the calendar cache in sync while `active`, i.e. once a user is signed in. */
export function useCalendarCache(active: Accessor<boolean>): void {
  const host = useGraphqlCalendarHost();
  const isLeader = createTabLeaderSignal('graphql-calendar-backfill:v1');
  const [generation, setGeneration] = createSignal(0);

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active()) return;
    // A reset drops the covered months the backfill lane already filled.
    const controller = new CalendarSyncController(cacheHost, {
      onReset: () => setGeneration((value) => value + 1),
    });
    setActiveCalendarSyncController(controller);
    const resync = (reason: CalendarStaleReason) => {
      controller.markStale(reason);
      startSyncStatusRefresh(controller);
    };
    resync('start');
    const unsubscribeReconnect = subscribeGraphqlSoupReconnected(() =>
      resync('reconnect')
    );
    const unsubscribeGeneration = cacheHost.onCacheGenerationChanged(() => {
      resync('generation');
      setGeneration((value) => value + 1);
    });
    const removeOnline = makeEventListener(window, 'online', () =>
      resync('online')
    );
    const removeVisibility = makeEventListener(
      document,
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          resync('visible');
        }
      }
    );
    const poll = setInterval(() => {
      if (latestCalendarSyncStatus() !== CalendarSyncStatus.syncing) return;
      resync('syncing');
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

  // A paused host is out of reach here, and settles creates before it returns.
  const settling = createMemo<ReturnType<typeof host>>(
    (last) => host() ?? last
  );
  createEffect(() => {
    const cacheHost = settling();
    if (!cacheHost || !active()) return;
    onCleanup(trackCalendarCreateSettlements(cacheHost));
  });

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active() || !isLeader()) return;
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
