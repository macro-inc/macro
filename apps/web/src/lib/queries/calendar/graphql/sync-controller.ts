import { fireAndForget } from '@core/util/fireAndForget';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import type {
  CacheHost,
  CalendarLinkWatermarkWire,
} from '@graphql-cache/index';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  CalendarChangesDocument,
  type CalendarChangesQuery,
  CalendarListRefreshDocument,
} from '@service-storage/graphql/generated/graphql';
import { ResultAsync } from 'neverthrow';
import { fetchCached } from './network';
import { calendarCacheAnswered, calendarRestAnswers } from './readiness';

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
  /** Called once a delta has dropped the cached calendar. */
  onReset?: () => void;
  debounceMs?: number;
}

/** An empty viewport reads only the stored watermark and freshness. */
const SYNC_STATE_RANGE = { startMs: 0, endMs: 0, startDay: 0, endDay: 0 };
const DEFAULT_DEBOUNCE_MS = 250;
/** Bounds one run; a scheduled run continues from the advanced watermark. */
const MAX_DELTA_PAGES = 50;
/** First wait before a failed run is retried; each further retry doubles it. */
export const DELTA_RETRY_BASE_MS = 2_000;
/** Retries after a failed run; later failures wait for the next poke. */
export const MAX_DELTA_RETRIES = 3;

/**
 * What a read about to answer from the cache did first. `current`: the cache
 * held everything already shown, so nothing ran. `held`: a delta ran, or a
 * running one was joined, and brought the cache forward. `retried`: as
 * `held`, with a retry of a failed delta. `behind`: the cache could not be
 * brought forward (the delta failed or stopped short, or a failed one's retry
 * is backing off or used up), so it may be older than what REST showed.
 */
export type CalendarCatchUp = 'current' | 'held' | 'retried' | 'behind';

/**
 * Why a delta dropped the cached calendar: the watermark fell behind the
 * server's retention, the server lists a link the cache never tracked, or
 * the cache tracked no link and now one is visible.
 */
type CalendarResetReason = 'retention' | 'new_link' | 'first_link';

type DeltaSpan = Pick<Span, 'setAttr' | 'error'>;

const eventKey = (id: string) => `GraphqlCalendarEvent:${id}`;
const occurrenceKey = (id: string) => `GraphqlCalendarOccurrence:${id}`;
const calendarKey = (id: string) => `GraphqlCalendar:${id}`;

export const fetchCalendarChanges: FetchCalendarChanges = async (since) =>
  (await fetchCached(CalendarChangesDocument, { input: { since } })).user
    .calendarChanges;

// An in-flight Calendars cache read can satisfy a second request with the
// same operation key. The refresh has its own key and writes the same field.
export const refetchCalendarList = () =>
  fetchCached(CalendarListRefreshDocument, {});

/**
 * Keeps cached calendar data current. Every poke, reconnect, or other
 * staleness signal runs `calendarChanges` from the stored watermark: each
 * page's records are written, then one commit replaces the changed events'
 * occurrence sets, deletes what the server deleted, and advances the
 * watermark. Without a stored watermark there is nothing to bring forward;
 * page fetches establish it. An empty one means rows were cached while no
 * inbox was visible: the server is asked for its watermark, and the cache
 * resets once it lists a link. A link the stored watermark lacks is never
 * adopted from a page, so the delta leaves it out and the server resets.
 *
 * A covered week is only as current as the last run, while a viewport REST
 * answered shows the server as it is. Reads therefore ask `catchUp` before
 * answering from the cache: after a REST answer, a run that read the server
 * after it has to finish first. A failed run is retried on its own a few
 * times with backoff.
 */
export class CalendarSyncController {
  private running: Promise<void> | undefined;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  // REST answers counted before the last complete run read the server, and
  // before the running pass did, once it has.
  private appliedRestAnswers = 0;
  private passRestAnswers: number | undefined;
  private failures = 0;
  private retryAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retrying = false;
  private readonly fetchChanges: FetchCalendarChanges;
  private readonly refetchCalendars: () => Promise<unknown>;
  private readonly onReset: () => void;
  private readonly debounceMs: number;

  constructor(
    private readonly host: Pick<CacheHost, 'calendarRange' | 'calendarCommit'>,
    options: CalendarSyncControllerOptions = {}
  ) {
    this.fetchChanges = options.fetchChanges ?? fetchCalendarChanges;
    this.refetchCalendars = options.refetchCalendars ?? refetchCalendarList;
    this.onReset = options.onReset ?? (() => {});
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
   * Whether the cache holds at least what any viewport already showed: the
   * last complete run read the server after every REST answer. A cache that
   * no REST read has overtaken is current, even when a run failed.
   */
  caughtUp(): boolean {
    return this.appliedRestAnswers >= calendarRestAnswers();
  }

  /**
   * Whether a read now could answer from the cache: it is caught up, a delta
   * is running, or one may start. False while a failed delta backs off or has
   * used its retries, when the read would go to REST.
   */
  canCatchUp(): boolean {
    return (
      this.caughtUp() ||
      this.running !== undefined ||
      this.failures === 0 ||
      this.retryDue()
    );
  }

  /**
   * Brings the cache forward before a read answers from it, when it may be
   * older than what is on screen. A running pass is joined, and run again
   * only if it read the server before the latest REST answer. After a failed
   * run, a new one starts only once its backoff has passed and retries
   * remain; otherwise the read is `behind`.
   */
  async catchUp(): Promise<CalendarCatchUp> {
    if (this.disposed || this.caughtUp()) return 'current';
    let run: Promise<void>;
    if (this.running) {
      const pass = this.passRestAnswers;
      if (pass !== undefined && pass < calendarRestAnswers()) this.rerun = true;
      run = this.running;
    } else {
      if (this.failures > 0) {
        if (!this.retryDue()) return 'behind';
        this.retrying = true;
      }
      run = this.runDelta();
    }
    const outcome = this.retrying ? 'retried' : 'held';
    const ran = await ResultAsync.fromPromise(run, (error) => error);
    if (ran.isErr() || this.disposed || !this.caughtUp()) return 'behind';
    return outcome;
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
    this.clearRetry();
    // A stale signal waiting on its debounce is covered by this run.
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const run = (async () => {
      try {
        do {
          this.rerun = false;
          this.passRestAnswers = undefined;
          try {
            const vouched = await this.applyChanges();
            this.failures = 0;
            if (vouched !== undefined) {
              this.appliedRestAnswers = Math.max(
                this.appliedRestAnswers,
                vouched
              );
            }
          } catch (error) {
            // The owner rejected only this old snapshot. Preserve an already
            // requested fresh pass instead of waiting for another external poke.
            if (!(error instanceof StaleCacheAuthorityError) || !this.rerun)
              throw error;
          }
        } while (this.rerun && !this.disposed);
      } catch (error) {
        this.recordFailure();
        throw error;
      } finally {
        this.running = undefined;
        this.passRestAnswers = undefined;
        this.retrying = false;
      }
    })();
    this.running = run;
    return run;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.clearRetry();
  }

  private retryDue(): boolean {
    return this.failures <= MAX_DELTA_RETRIES && Date.now() >= this.retryAt;
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  // A run can fail while the cache changes owner, which nothing else would
  // follow up on: retry it with backoff, a bounded number of times.
  private recordFailure(): void {
    this.failures += 1;
    this.clearRetry();
    if (this.disposed || this.failures > MAX_DELTA_RETRIES) return;
    const delay = DELTA_RETRY_BASE_MS * 2 ** (this.failures - 1);
    this.retryAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      fireAndForget(this.retry(), 'calendar-delta-retry');
    }, delay);
  }

  private async retry(): Promise<void> {
    if (!this.running) this.retrying = true;
    const run = await ResultAsync.fromPromise(this.runDelta(), (e) => e);
    if (run.isErr())
      console.warn('Calendar delta sync retry failed', run.error);
  }

  /**
   * Returns the REST answers counted before this pass read the server, or
   * `undefined` when it stopped before the end of the change log.
   */
  private applyChanges(): Promise<number | undefined> {
    return Telemetry.span('calendar.delta_sync', async (span) => {
      const pass = await ResultAsync.fromPromise(
        this.applyChangesIn(span),
        (error) => error
      );
      if (pass.isErr()) {
        span.error(pass.error);
        throw pass.error;
      }
      return pass.value;
    });
  }

  private async applyChangesIn(span: DeltaSpan): Promise<number | undefined> {
    const generation = cacheSessionGeneration.capture();
    const state = await this.host.calendarRange(SYNC_STATE_RANGE);
    const restAnswers = calendarRestAnswers();
    this.passRestAnswers = restAnswers;
    if (state.kind === 'unsupported' || !state.watermark) return restAnswers;
    span.setAttr('calendar.delta.links', state.watermark.length);
    if (state.watermark.length === 0) {
      // Rows cached while no inbox was visible: no change log reaches them,
      // and the server answers an empty `since` with its watermark alone.
      const current = await this.fetchChanges([]);
      span.setAttr('calendar.delta.pages', 1);
      const to = current.newWatermark.map(({ linkId, seq }) => ({
        linkId,
        seq,
      }));
      if (to.length > 0) await this.reset(to, generation, span, 'first_link');
      return restAnswers;
    }
    let since = state.watermark;
    let calendarsChanged = false;
    let hasMore = false;
    let pages = 0;
    for (let page = 0; page < MAX_DELTA_PAGES && !this.disposed; page += 1) {
      const changes = await this.fetchChanges(since);
      pages += 1;
      span.setAttr('calendar.delta.pages', pages);
      const to = changes.newWatermark.map(({ linkId, seq }) => ({
        linkId,
        seq,
      }));
      if (changes.resetRequired) {
        const tracked = new Set(since.map((link) => link.linkId));
        const reason = to.some((link) => !tracked.has(link.linkId))
          ? 'new_link'
          : 'retention';
        await this.reset(to, generation, span, reason);
        return restAnswers;
      }
      const visible = new Set(to.map((link) => link.linkId));
      const removedLinkIds = since
        .map((link) => link.linkId)
        .filter((linkId) => !visible.has(linkId));
      await this.host.calendarCommit(
        {
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
        },
        generation
      );
      calendarsChanged ||=
        changes.calendars.length > 0 ||
        changes.deletedCalendarIds.length > 0 ||
        removedLinkIds.length > 0;
      hasMore = changes.hasMore;
      if (!hasMore) break;
      since = to;
    }
    span.setAttr('calendar.delta.has_more', hasMore);
    if (calendarsChanged) await this.refetchCalendars();
    if (hasMore) this.markStale('continue');
    return hasMore || this.disposed ? undefined : restAnswers;
  }

  /**
   * Drops every cached occurrence, event and covered span and starts over
   * from the server's watermark. Visible ranges observe the cleared coverage
   * and refetch.
   */
  private async reset(
    to: CalendarLinkWatermarkWire[],
    generation: string,
    span: DeltaSpan,
    reason: CalendarResetReason
  ): Promise<void> {
    span.setAttr('calendar.delta.reset', reason);
    await this.host.calendarCommit(
      { reset: true, watermark: { kind: 'merge', links: to } },
      generation
    );
    this.onReset();
    await this.refetchCalendars();
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

import { cacheSessionGeneration } from '@graphql-cache/session-generation';
