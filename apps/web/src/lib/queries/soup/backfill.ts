import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_BACKFILL,
  enableStreamedCacheSync,
} from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import {
  type GraphqlEmailExpr,
  SoupBackfillDocument,
  SoupMailBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInitialInput,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  hydrateGraphqlSoup,
} from '@service-storage/graphql-soup';
import { createSharedMailBackfillFetcher } from '@service-storage/shared-mail-backfill';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import {
  CHANNEL_DIRECTORY_CHECKPOINT_ID,
  CHANNEL_DIRECTORY_INPUT,
} from '../channel/directory-lane';
import {
  ChannelDirectoryPassUnproven,
  channelDirectoryBackfillFetcher,
} from '../channel/directory-reconcile';
import { useContactBackfill } from '../contacts/backfill';
import type { ContextChannel } from '../contacts/context-facts';
import { useContactTopUp } from '../contacts/top-up';
import { useContactContextPublisher } from '../contacts/use-context-publisher';
import { useMailAccountsQuery } from '../email/mail-accounts';
import {
  BACKFILL_VERSION,
  initialSoupBackfillCheckpoint,
  loadSoupBackfillCheckpoint as loadCheckpoint,
  markSoupBackfillLaneFailed,
  type SoupBackfillCheckpoint,
  saveSoupBackfillCheckpoint,
} from './backfill-checkpoint';
import { isSyncHost } from './sync/host';
import { runStreamedSyncUntilDone } from './sync/stream';

const PAGE_LIMIT = 100;
// Five threads × twenty messages reaches the backend's 100-message cap.
const EMAIL_CONTENT_PAGE_LIMIT = 5;
const PAGE_DELAY_MS = 2_000;
const BACKFILL_RETRY_COUNT = 5;
const BACKFILL_RETRY_SCHEDULE = Schedule.exponential('1 second');
const CACHE_HOST_RETRY_COUNT = 6;
const CACHE_HOST_RETRY_SCHEDULE = Schedule.exponential('100 millis');
const BACKFILL_PROGRESS_PAGE_INTERVAL = 10;
const EXCLUDED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Email threads of one signal classification whose latest message is at most
 * `days` old. */
type EmailRecencyWindow = { signal: boolean; days: number };

const SIGNAL_EMAIL_WINDOW: EmailRecencyWindow = { signal: true, days: 90 };
const NOISE_EMAIL_WINDOW: EmailRecencyWindow = { signal: false, days: 30 };

type SoupBackfillFetchPage = (
  input: GraphqlSoupInput,
  options?: FetchGraphqlSoupOptions
) => Promise<GraphqlSoupHydrationPage>;

const fetchSoupPage: SoupBackfillFetchPage = (input, options) =>
  hydrateGraphqlSoup(SoupBackfillDocument, { input }, options);

const fetchEmailContentPage: SoupBackfillFetchPage = (input, options) =>
  hydrateGraphqlSoup(SoupBackfillDocument, { input }, options);

export type SoupBackfillParams = {
  /** Stable checkpoint namespace. Change it when the input changes. */
  checkpointId: string;
  /** Optional network fetcher; defaults to the standard Soup operation. */
  fetchPage?: SoupBackfillFetchPage;
  /** Allocate per-scan membership evidence (never shared across users or retries). */
  createFetchPage?: (
    userId: string,
    signal?: AbortSignal
  ) => Promise<SoupBackfillFetchPage>;
  /** Access-scope reconciliation requires a fresh full scan after interruption. */
  restartOnRun?: boolean;
  /** Whether a retry after this error goes on from the failed attempt's
   * cursor, with the page fetcher that read the pages before it. Otherwise a
   * retry starts like a new run (at the top, with `restartOnRun`). */
  resumesAfter?: (error: unknown) => boolean;
  /** Soup input shared by every page. The backfill manages the cursor. */
  input: GraphqlSoupInitialInput;
  /** Delay between successful pages. Defaults to two seconds. */
  pageDelayMs?: number;
  /** Immediately follows the initial full scan with its watermark pass. */
  catchUpAfterInitialPass?: boolean;
  /** Refresh the whole metadata corpus: message-time watermarks do not capture
   * read/archive changes to old email threads. Interrupted scans still resume. */
  refreshAll?: boolean;
  /** Email threads matching any window. The cutoff is fixed when a pass starts;
   * resumed cursors keep the cutoff they were issued with. */
  emailRecency?: readonly EmailRecencyWindow[];
};

/**
 * Every channel the viewer can see, ahead of the mixed core lane, so the cache
 * holds the whole channel list soon after login rather than once documents and
 * chats have paged through with it.
 */
export const CHANNEL_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: CHANNEL_DIRECTORY_CHECKPOINT_ID,
  // Every pass is a full one (the channel filter has no update-time literal),
  // so a finished pass also removes the cached channels it proves stale.
  createFetchPage: channelDirectoryBackfillFetcher,
  refreshAll: true,
  // A pass resumed from a cursor cannot tell which channels are stale, and
  // the fetcher fails its last page, so a run always starts at the top.
  restartOnRun: true,
  // A retry goes on with the fetcher that saw the pages before its cursor,
  // so one failed page does not cost a large account its whole pass. Not
  // when that fetcher could not prove the pass: it would fail again.
  resumesAfter: (error) => !(error instanceof ChannelDirectoryPassUnproven),
  // One request per 100 channels: 2 s spacing takes minutes on a large account.
  pageDelayMs: 250,
  input: CHANNEL_DIRECTORY_INPUT,
};

/** Backfills documents, chats, and folders for Quick Access and primary views. */
export const CORE_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'core-entities',
  // Quick Access waits on this lane, and every other lane waits behind it.
  pageDelayMs: 250,
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
      calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
      channelFilter: { literal: { channelId: EXCLUDED_ENTITY_ID } },
      channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
      callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
      crmCompanyFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      foreignEntityFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    },
  },
};

/** Task projects (initiatives), which Soup returns only when a filter opts in,
 * so Quick Access can search them from the cache. */
export const INITIATIVE_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'initiatives',
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
      calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      documentFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      projectFilter: { literal: { projectIdSelf: EXCLUDED_ENTITY_ID } },
      chatFilter: { literal: { chatId: EXCLUDED_ENTITY_ID } },
      emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
      channelFilter: { literal: { channelId: EXCLUDED_ENTITY_ID } },
      channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
      callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
      crmCompanyFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      foreignEntityFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      initiativeFilter: { literal: { include: true } },
    },
  },
};

/**
 * Email threads and the first message page used by the thread view, excluding
 * every other entity variant with an impossible id filter.
 */
const EMAIL_THREAD_PAGES_INPUT: GraphqlSoupInitialInput = {
  limit: EMAIL_CONTENT_PAGE_LIMIT,
  expand: true,
  // Orders by the latest-message timestamp that emailRecency bounds, so each
  // page is an ordered index range ending at the cutoff.
  sortMethod: 'UPDATED_AT',
  emailView: 'ALL',
  filters: {
    calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    documentFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    projectFilter: { literal: { projectIdSelf: EXCLUDED_ENTITY_ID } },
    chatFilter: { literal: { chatId: EXCLUDED_ENTITY_ID } },
    channelFilter: { literal: { channelId: EXCLUDED_ENTITY_ID } },
    channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
    callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
    crmCompanyFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    foreignEntityFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
  },
};

const EMAIL_THREAD_PAGES_LANE = {
  fetchPage: fetchEmailContentPage,
  // A long full scan can skip threads that receive messages after its cursor
  // has passed them. Consume the recorded watermark before reporting the lane
  // complete.
  catchUpAfterInitialPass: true,
  input: EMAIL_THREAD_PAGES_INPUT,
} satisfies Omit<SoupBackfillParams, 'checkpointId'>;

export const SIGNAL_EMAIL_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  ...EMAIL_THREAD_PAGES_LANE,
  checkpointId: 'email-signal-thread-pages',
  emailRecency: [SIGNAL_EMAIL_WINDOW],
};

export const NOISE_EMAIL_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  ...EMAIL_THREAD_PAGES_LANE,
  checkpointId: 'email-noise-thread-pages',
  emailRecency: [NOISE_EMAIL_WINDOW],
};

/** Filter/row metadata is synchronized before the independently bounded body cache.
 * ALL covers the first Mail slice across every readable owned/delegated inbox. */
const EMAIL_FILTER_LANE = {
  fetchPage: (input, options) =>
    hydrateGraphqlSoup(SoupMailBackfillDocument, { input }, options),
  refreshAll: true,
  input: { ...EMAIL_THREAD_PAGES_INPUT, limit: PAGE_LIMIT },
} satisfies Omit<SoupBackfillParams, 'checkpointId'>;

export const SIGNAL_EMAIL_FILTER_BACKFILL_LANE: SoupBackfillParams = {
  ...EMAIL_FILTER_LANE,
  checkpointId: 'email-signal-filter-metadata',
  emailRecency: [SIGNAL_EMAIL_WINDOW],
};

export const NOISE_EMAIL_FILTER_BACKFILL_LANE: SoupBackfillParams = {
  ...EMAIL_FILTER_LANE,
  checkpointId: 'email-noise-filter-metadata',
  emailRecency: [NOISE_EMAIL_WINDOW],
};

/** Shared grants are separate from owned/delegated inbox scope. A complete scan
 * invalidates omitted old proof; interrupted scans preserve last-known evidence.
 * One lane covers both windows because each scan invalidates every cached
 * Shared thread it did not return, including threads outside the windows. */
export const SHARED_EMAIL_FILTER_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'shared-email-filter-metadata',
  // Its second parameter is the cache host, not the run's signal.
  createFetchPage: (userId) => createSharedMailBackfillFetcher(userId),
  refreshAll: true,
  restartOnRun: true,
  emailRecency: [SIGNAL_EMAIL_WINDOW, NOISE_EMAIL_WINDOW],
  input: {
    ...EMAIL_FILTER_LANE.input,
    filters: {
      ...EMAIL_FILTER_LANE.input.filters,
      emailFilter: { tree: { literal: { shared: 'ONLY' } } },
    },
  },
};

/** Backfills CRM companies, contacts, and foreign entities. */
export const AUXILIARY_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'auxiliary-entities',
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
      calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      documentFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      projectFilter: { literal: { projectIdSelf: EXCLUDED_ENTITY_ID } },
      chatFilter: { literal: { chatId: EXCLUDED_ENTITY_ID } },
      emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
      channelFilter: { literal: { channelId: EXCLUDED_ENTITY_ID } },
      channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
      callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
      crmContactFilter: { literal: { include: true } },
    },
  },
};

/** Independently checkpointed backfills run serially in priority order. */
export const DEFAULT_SOUP_BACKFILL_LANES = [
  CHANNEL_SOUP_BACKFILL_LANE,
  CORE_SOUP_BACKFILL_LANE,
  INITIATIVE_SOUP_BACKFILL_LANE,
  SIGNAL_EMAIL_FILTER_BACKFILL_LANE,
  NOISE_EMAIL_FILTER_BACKFILL_LANE,
  SHARED_EMAIL_FILTER_BACKFILL_LANE,
  SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
  NOISE_EMAIL_SOUP_BACKFILL_LANE,
  AUXILIARY_SOUP_BACKFILL_LANE,
] as const satisfies readonly SoupBackfillParams[];

export type { SoupBackfillCheckpoint };

export function loadSoupBackfillCheckpoint(
  userId: string,
  checkpointId = CORE_SOUP_BACKFILL_LANE.checkpointId
): SoupBackfillCheckpoint {
  return loadCheckpoint(userId, checkpointId);
}

type SoupBackfillTelemetryState =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

function recordSoupBackfillTelemetry(input: {
  checkpointId: string;
  durationMs?: number;
  pagesFetched: number;
  state: SoupBackfillTelemetryState;
  totalPagesFetched: number;
}): void {
  try {
    const span = Telemetry.anonymousSpan('graphql_cache.backfill');
    span.setAttr('cache.backfill_lane', input.checkpointId);
    span.setAttr('cache.backfill_version', BACKFILL_VERSION);
    span.setAttr('cache.backfill_state', input.state);
    span.setAttr('cache.backfill_pages_fetched', input.pagesFetched);
    span.setAttr('cache.backfill_total_pages_fetched', input.totalPagesFetched);
    if (input.durationMs !== undefined) {
      span.setAttr('cache.duration_ms', input.durationMs);
    }
    span.end();
  } catch {
    // Observability must never affect cache hydration.
  }
}

function and<T>(left: T | null | undefined, right: T): T {
  return left ? ({ and: { left, right } } as T) : right;
}

/**
 * Restricts entity types that expose an updatedAt filter while preserving any
 * caller-provided filters. Other entity types continue to be fetched normally.
 */
export function withUpdatedSince(
  input: GraphqlSoupInitialInput,
  updatedSince: string | null
): GraphqlSoupInitialInput {
  if (!updatedSince) return input;

  const filters = input.filters ?? {};
  const documentUpdatedAt = {
    literal: { updatedAt: { gte: updatedSince } },
  };

  const projectUpdatedAt = {
    literal: { updatedAt: { gte: updatedSince } },
  };

  const chatUpdatedAt = {
    literal: { updatedAt: { gte: updatedSince } },
  };

  // A cached email row changes through either the thread timestamp or this
  // viewer's history timestamp, and VIEWED_UPDATED sorts on both. Cover both.
  const emailSortWatermark = {
    or: {
      left: { literal: { updatedAt: { gte: updatedSince } } },
      right: { literal: { viewedAt: { gte: updatedSince } } },
    },
  };

  return {
    ...input,
    filters: {
      ...filters,
      documentFilter: and(filters.documentFilter, documentUpdatedAt),
      projectFilter: and(filters.projectFilter, projectUpdatedAt),
      chatFilter: and(filters.chatFilter, chatUpdatedAt),
      emailFilter: {
        ...(filters.emailFilter ?? {}),
        tree: and(filters.emailFilter?.tree, emailSortWatermark),
      },
    },
  };
}

/**
 * Restricts email threads to those matching any window. In the ALL view the
 * email updatedAt literal compares the latest non-spam message timestamp.
 */
function withEmailRecency(
  input: GraphqlSoupInitialInput,
  windows: readonly EmailRecencyWindow[] | undefined,
  now: number
): GraphqlSoupInitialInput {
  if (!windows?.length) return input;

  const recency = windows
    .map(
      ({ signal, days }): GraphqlEmailExpr => ({
        and: {
          left: { literal: { importance: signal } },
          right: {
            literal: {
              updatedAt: { gte: new Date(now - days * DAY_MS).toISOString() },
            },
          },
        },
      })
    )
    .reduce((left, right) => ({ or: { left, right } }));
  const filters = input.filters ?? {};
  return {
    ...input,
    filters: {
      ...filters,
      emailFilter: {
        ...(filters.emailFilter ?? {}),
        tree: and(filters.emailFilter?.tree, recency),
      },
    },
  };
}

type SoupBackfillCacheHost = Pick<CacheHost, 'currentStorageGeneration'>;

/** What an attempt of a lane leaves the retry after it. */
export type SoupBackfillRetry = {
  /** The page fetcher of the pass the attempt was on, and the storage
   * generation it read into. */
  pageFetcher?: {
    storageGeneration: string;
    fetchPage: SoupBackfillFetchPage;
  };
};

/** What a failed Effect step threw. */
const thrownBy = (error: unknown) =>
  Cause.isUnknownError(error) ? error.cause : error;

export const runSoupBackfill = Effect.fn('runSoupBackfill')(function* (
  userId: string,
  host: SoupBackfillCacheHost,
  params: SoupBackfillParams,
  onCheckpoint?: (checkpoint: SoupBackfillCheckpoint) => void,
  retry?: SoupBackfillRetry
) {
  // Await storage readiness before reading a cursor. Generation notifications
  // may predate this runner or belong to another tab, so they cannot prove that
  // a saved continuation still refers to records in the current database.
  const storageGeneration = yield* Effect.tryPromise(() =>
    host.currentStorageGeneration()
  );
  let checkpoint = yield* Effect.sync(() =>
    loadSoupBackfillCheckpoint(userId, params.checkpointId)
  );
  const storedHere = checkpoint.storageGeneration === storageGeneration;
  if (!storedHere) {
    checkpoint = initialSoupBackfillCheckpoint(userId, storageGeneration);
  }
  // A retry goes on from the cursor of the pass the failed attempt left
  // unfinished, with the fetcher that read the pages before it.
  const resuming =
    storedHere &&
    !checkpoint.completed &&
    checkpoint.scanStartedAt !== null &&
    retry?.pageFetcher?.storageGeneration === storageGeneration;
  if (retry && !resuming) retry.pageFetcher = undefined;
  if (params.restartOnRun && !resuming) {
    checkpoint = {
      ...checkpoint,
      nextCursor: null,
      completed: false,
      pagesFetched: 0,
      scanStartedAt: null,
    };
  }
  const startPass = () => {
    checkpoint = {
      ...checkpoint,
      nextCursor: checkpoint.completed ? null : checkpoint.nextCursor,
      completed: false,
      scanStartedAt: new Date().toISOString(),
    };
    saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);
  };
  const restartForGeneration = (generation: string) => {
    checkpoint = initialSoupBackfillCheckpoint(userId, generation);
    startPass();
  };
  const createPageFetcher = Effect.fnUntraced(function* (generation: string) {
    const kept = retry?.pageFetcher;
    if (kept?.storageGeneration === generation) return kept.fetchPage;
    if (retry) retry.pageFetcher = undefined;
    const create = params.createFetchPage;
    const fetchPage = create
      ? yield* Effect.tryPromise((signal) => create(userId, signal))
      : (params.fetchPage ?? fetchSoupPage);
    if (retry) retry.pageFetcher = { storageGeneration: generation, fetchPage };
    return fetchPage;
  });

  // `completed` marks the end of one pass. Start a fresh pass from its stored
  // watermark, while an unfinished checkpoint keeps its cursor.
  if (checkpoint.completed || checkpoint.scanStartedAt === null) {
    yield* Effect.sync(startPass);
  }
  let fetchPage = yield* createPageFetcher(storageGeneration);

  while (true) {
    const beforeFetchGeneration = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    if (checkpoint.storageGeneration !== beforeFetchGeneration) {
      yield* Effect.sync(() => restartForGeneration(beforeFetchGeneration));
      fetchPage = yield* createPageFetcher(beforeFetchGeneration);
      continue;
    }
    const passInput = withUpdatedSince(
      withEmailRecency(params.input, params.emailRecency, Date.now()),
      params.refreshAll ? null : checkpoint.updatedSince
    );
    const input: GraphqlSoupInput = checkpoint.nextCursor
      ? {
          continuation: {
            cursor: checkpoint.nextCursor,
            expand: passInput.expand,
            emailView: passInput.emailView,
            // The cursor does not carry where channels are read.
            ...(passInput.channelReads
              ? { channelReads: passInput.channelReads }
              : {}),
          },
        }
      : { initial: passInput };
    // Hydration returns only the cursor projection. Cache-only entity
    // payloads are persisted without being materialized back into this page.
    const page = yield* Effect.tryPromise((signal) =>
      fetchPage(input, { signal })
    );
    const afterFetchGeneration = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    if (checkpoint.storageGeneration !== afterFetchGeneration) {
      // A reset during hydration invalidates the page's continuation even when
      // its request could not be cancelled. Never save it into the new scan.
      yield* Effect.sync(() => restartForGeneration(afterFetchGeneration));
      fetchPage = yield* createPageFetcher(afterFetchGeneration);
      continue;
    }

    const passCompleted = page.nextCursor == null;
    // Only a never-completed full scan needs the additional watermark pass. An
    // interrupted catch-up already has updatedSince and resumes normally.
    const transitionToCatchUp =
      passCompleted &&
      params.catchUpAfterInitialPass === true &&
      checkpoint.updatedSince === null;
    const passCompletedAt = passCompleted ? new Date().toISOString() : null;
    checkpoint = {
      ...checkpoint,
      nextCursor: page.nextCursor ?? null,
      pagesFetched: checkpoint.pagesFetched + 1,
      // Atomically persist the required catch-up as in progress instead of
      // exposing a completed lane between the two passes.
      completed: passCompleted && !transitionToCatchUp,
      ...(passCompleted
        ? transitionToCatchUp
          ? {
              // Filter from the full pass start, while using its completion
              // as the resumable catch-up pass watermark.
              updatedSince: checkpoint.scanStartedAt ?? checkpoint.updatedSince,
              completedAt: null,
              scanStartedAt: passCompletedAt,
            }
          : {
              // Use the pass start rather than its completion time so updates
              // made while this pass was running are included next time.
              updatedSince: checkpoint.scanStartedAt ?? checkpoint.updatedSince,
              completedAt: passCompletedAt,
              scanStartedAt: null,
            }
        : {}),
    };
    yield* Effect.sync(() => {
      saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);
      onCheckpoint?.(checkpoint);
    });

    if (checkpoint.completed) return;
    // The terminal page transitions directly into the narrowed catch-up pass.
    if (!passCompleted) {
      yield* Effect.sleep(params.pageDelayMs ?? PAGE_DELAY_MS);
    }
  }
});

/** Runs each backfill lane to completion before starting the next lane. */
export const runSoupBackfills = Effect.fn('runSoupBackfills')(function* (
  userId: string,
  host: SoupBackfillCacheHost,
  lanes: readonly SoupBackfillParams[] = DEFAULT_SOUP_BACKFILL_LANES
) {
  yield* Effect.forEach(
    lanes,
    (lane) =>
      Effect.gen(function* () {
        const startedAt = Date.now();
        const initialCheckpoint = yield* Effect.sync(() =>
          loadSoupBackfillCheckpoint(userId, lane.checkpointId)
        );
        let pagesFetched = 0;
        yield* Effect.sync(() =>
          recordSoupBackfillTelemetry({
            checkpointId: lane.checkpointId,
            pagesFetched: 0,
            state: 'started',
            totalPagesFetched: initialCheckpoint.pagesFetched,
          })
        );

        // Kept across the attempts of a lane whose retries can resume.
        const retry: SoupBackfillRetry | undefined = lane.resumesAfter
          ? {}
          : undefined;
        const onCheckpoint = (checkpoint: SoupBackfillCheckpoint) => {
          pagesFetched += 1;
          if (
            !checkpoint.completed &&
            pagesFetched % BACKFILL_PROGRESS_PAGE_INTERVAL === 0
          ) {
            recordSoupBackfillTelemetry({
              checkpointId: lane.checkpointId,
              durationMs: Date.now() - startedAt,
              pagesFetched,
              state: 'progress',
              totalPagesFetched: checkpoint.pagesFetched,
            });
          }
        };

        yield* runSoupBackfill(userId, host, lane, onCheckpoint, retry).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (retry && !lane.resumesAfter?.(thrownBy(error)))
                retry.pageFetcher = undefined;
            })
          ),
          Effect.retry({
            times: BACKFILL_RETRY_COUNT,
            schedule: BACKFILL_RETRY_SCHEDULE,
          }),
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                const checkpoint = yield* Effect.sync(() =>
                  loadSoupBackfillCheckpoint(userId, lane.checkpointId)
                );
                // Readers check the cache's generation now. A lane that
                // failed before it saved a page in it left only an older
                // generation in its checkpoint.
                const generation = yield* Effect.tryPromise(() =>
                  host.currentStorageGeneration()
                ).pipe(
                  Effect.orElseSucceed(() => checkpoint.storageGeneration)
                );
                yield* Effect.sync(() => {
                  recordSoupBackfillTelemetry({
                    checkpointId: lane.checkpointId,
                    durationMs: Date.now() - startedAt,
                    pagesFetched,
                    state: 'failed',
                    totalPagesFetched: checkpoint.pagesFetched,
                  });
                  // Readers waiting for the lane to finish stop waiting.
                  if (generation !== null)
                    markSoupBackfillLaneFailed(
                      userId,
                      lane.checkpointId,
                      generation
                    );
                  console.warn(
                    '[graphql-soup-backfill] lane failed after retries',
                    { checkpointId: lane.checkpointId, error }
                  );
                });
              }),
            onSuccess: () =>
              Effect.sync(() => {
                const checkpoint = loadSoupBackfillCheckpoint(
                  userId,
                  lane.checkpointId
                );
                recordSoupBackfillTelemetry({
                  checkpointId: lane.checkpointId,
                  durationMs: Date.now() - startedAt,
                  pagesFetched,
                  state: 'completed',
                  totalPagesFetched: checkpoint.pagesFetched,
                });
              }),
          })
        );
      }),
    { concurrency: 1, discard: true }
  );
});

/**
 * Keeps the cache synced: through the streamed sync when `streamed` is on and
 * the host can stream, otherwise through the paged backfill. A host that
 * reports it cannot stream (an older native build), or a server that refuses
 * its cache engine's sync protocol (426), falls back to the paged backfill
 * too. A streamed sync that stops after its retries runs again once
 * the device is back online, the app is back in the foreground, or a pause
 * ran out.
 */
export function runCacheSync(
  userId: string,
  host: CacheHost,
  streamed: boolean
): Effect.Effect<void> {
  const paged = runSoupBackfills(userId, host).pipe(Effect.ignore);
  if (!streamed || !isSyncHost(host)) return paged;
  return runStreamedSyncUntilDone(host).pipe(Effect.catch(() => paged));
}

const waitForGraphqlSoupCacheHost = Effect.suspend(() => {
  const host = getGraphqlSoupCacheHost();
  return !host || host.disabled
    ? Effect.fail('cache-host-unavailable' as const)
    : Effect.succeed(host);
}).pipe(
  Effect.retry({
    times: CACHE_HOST_RETRY_COUNT,
    schedule: CACHE_HOST_RETRY_SCHEDULE,
  })
);

/**
 * Keeps the signed-in user's cache synced while this tab owns leadership;
 * waits while `userId` is unknown. A user, leadership, flag or cache
 * generation change interrupts the run (stopping the host's stream) and starts
 * another, which resumes from the state saved in the cache database.
 * `directoryChannels` feeds contact facts: the complete channel directory.
 */
export function useSoupBackfills(
  userId: Accessor<string | undefined>,
  directoryChannels: Accessor<readonly ContextChannel[] | undefined>
): void {
  const streamedSyncFlag = useFeatureFlag(enableStreamedCacheSync);
  const streamedSync = () => streamedSyncFlag().enabled;
  const isLeader = createTabLeaderSignal(
    `graphql-soup-backfill:v${BACKFILL_VERSION}:coordinator`
  );
  // Sender metadata must be durable before the first composer is opened.
  // This small catalog runs alongside the sync, never behind it.
  useMailAccountsQuery(
    () => ENABLE_GRAPHQL_BACKFILL && isLeader() && !!userId()
  );
  const [cacheHost, setCacheHost] = createSignal<CacheHost>();
  const [cacheGeneration, setCacheGeneration] = createSignal(0);
  useContactBackfill(userId, cacheHost, cacheGeneration);
  useContactTopUp(userId, cacheHost, cacheGeneration);
  useContactContextPublisher(cacheHost, cacheGeneration, directoryChannels);

  createEffect(() => {
    if (!ENABLE_GRAPHQL_BACKFILL || !isLeader()) {
      setCacheHost(undefined);
      return;
    }

    const fiber = Effect.runFork(
      waitForGraphqlSoupCacheHost.pipe(
        Effect.tap((host) => Effect.sync(() => setCacheHost(host))),
        Effect.ignore
      )
    );
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });

  createEffect(() => {
    const host = cacheHost();
    if (!host) return;

    const unsubscribe = host.onCacheGenerationChanged(() => {
      setCacheGeneration((generation) => generation + 1);
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const host = cacheHost();
    const id = userId();
    if (!host || !id) return;
    cacheGeneration();

    const fiber = Effect.runFork(runCacheSync(id, host, streamedSync()));
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
