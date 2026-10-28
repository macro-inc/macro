import type {
  CacheHost,
  CalendarLinkWatermarkWire,
} from '@graphql-cache/index';
import {
  CalendarChangesDocument,
  type CalendarChangesQuery,
  CalendarsDocument,
} from '@service-storage/graphql/generated/graphql';
import { fetchCached } from './network';
import { calendarCacheAnswered } from './readiness';

export type CalendarChangesPage =
  CalendarChangesQuery['user']['calendarChanges'];

/** Fetches one delta page and resolves once its records are cached. */
export type FetchCalendarChanges = (
  since: CalendarLinkWatermarkWire[]
) => Promise<CalendarChangesPage>;

export type CalendarStaleReason =
  | 'poke'
  | 'start'
  | 'reconnect'
  | 'online'
  | 'visible'
  | 'generation'
  | 'syncing'
  | 'continue';

export interface CalendarSyncControllerOptions {
  fetchChanges?: FetchCalendarChanges;
  /** Refetches the calendar list after calendars or links change. */
  refetchCalendars?: () => Promise<unknown>;
  debounceMs?: number;
}

/** An empty viewport reads only the stored watermark and freshness. */
const SYNC_STATE_RANGE = { startMs: 0, endMs: 0, startDay: 0, endDay: 0 };
const DEFAULT_DEBOUNCE_MS = 250;
/** Bounds one run; a scheduled run continues from the advanced watermark. */
const MAX_DELTA_PAGES = 50;

const eventKey = (id: string) => `GraphqlCalendarEvent:${id}`;
const occurrenceKey = (id: string) => `GraphqlCalendarOccurrence:${id}`;
const calendarKey = (id: string) => `GraphqlCalendar:${id}`;

export const fetchCalendarChanges: FetchCalendarChanges = async (since) =>
  (await fetchCached(CalendarChangesDocument, { input: { since } })).user
    .calendarChanges;

export const refetchCalendarList = () => fetchCached(CalendarsDocument, {});

/**
 * Keeps cached calendar data current. Every poke, reconnect, or other
 * staleness signal runs `calendarChanges` from the stored watermark: each
 * page's records are written, then one commit replaces the changed events'
 * occurrence sets, deletes what the server deleted, and advances the
 * watermark. Without a stored watermark there is nothing to bring forward;
 * page fetches establish it.
 */
export class CalendarSyncController {
  private running: Promise<void> | undefined;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly fetchChanges: FetchCalendarChanges;
  private readonly refetchCalendars: () => Promise<unknown>;
  private readonly debounceMs: number;

  constructor(
    private readonly host: Pick<CacheHost, 'calendarRange' | 'calendarCommit'>,
    options: CalendarSyncControllerOptions = {}
  ) {
    this.fetchChanges = options.fetchChanges ?? fetchCalendarChanges;
    this.refetchCalendars = options.refetchCalendars ?? refetchCalendarList;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Whether the cache has answered a calendar read, so a run cannot stall on cache startup. */
  answering(): boolean {
    return calendarCacheAnswered(this.host);
  }

  /** Schedules one debounced delta run. */
  markStale(_reason: CalendarStaleReason): void {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.runDelta().catch((error) => {
        console.warn('Calendar delta sync failed', error);
      });
    }, this.debounceMs);
  }

  /**
   * Applies every change after the stored watermark. A call during a run
   * joins it and makes it run once more, so the caller sees its change.
   */
  runDelta(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    const run = (async () => {
      try {
        do {
          this.rerun = false;
          await this.applyChanges();
        } while (this.rerun && !this.disposed);
      } finally {
        this.running = undefined;
      }
    })();
    this.running = run;
    return run;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async applyChanges(): Promise<void> {
    const state = await this.host.calendarRange(SYNC_STATE_RANGE);
    if (state.kind === 'unsupported' || !state.watermark?.length) return;
    let since = state.watermark;
    let calendarsChanged = false;
    let hasMore = false;
    for (let page = 0; page < MAX_DELTA_PAGES && !this.disposed; page += 1) {
      const changes = await this.fetchChanges(since);
      const to = changes.newWatermark.map(({ linkId, seq }) => ({
        linkId,
        seq,
      }));
      if (changes.resetRequired) {
        // Visible ranges observe the cleared coverage and refetch.
        await this.host.calendarCommit({
          reset: true,
          watermark: { kind: 'merge', links: to },
        });
        await this.refetchCalendars();
        return;
      }
      const visible = new Set(to.map((link) => link.linkId));
      const removedLinkIds = since
        .map((link) => link.linkId)
        .filter((linkId) => !visible.has(linkId));
      await this.host.calendarCommit({
        replacedEvents: changes.events.map((change) => ({
          eventKey: eventKey(change.event.id),
          occurrenceKeys: change.occurrences.map((occurrence) =>
            occurrenceKey(occurrence.id)
          ),
        })),
        deletedEventKeys: changes.deletedEventIds.map(eventKey),
        deletedCalendarKeys: changes.deletedCalendarIds.map(calendarKey),
        removedLinkIds,
        watermark: { kind: 'advance', since, to },
        ...(changes.hasMore ? {} : { freshness: 'fresh' as const }),
      });
      calendarsChanged ||=
        changes.calendars.length > 0 ||
        changes.deletedCalendarIds.length > 0 ||
        removedLinkIds.length > 0;
      hasMore = changes.hasMore;
      if (!hasMore) break;
      since = to;
    }
    if (calendarsChanged) await this.refetchCalendars();
    if (hasMore) this.markStale('continue');
  }
}

let activeController: CalendarSyncController | undefined;

/** The controller of the mounted calendar cache, if any. */
export function activeCalendarSyncController():
  | CalendarSyncController
  | undefined {
  return activeController;
}

export function setActiveCalendarSyncController(
  controller: CalendarSyncController | undefined
): void {
  activeController = controller;
}
