import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_BACKFILL,
  enableGraphqlSoup,
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
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

// Bump when a default backfill input or completion guarantee changes so
// persisted cursors cannot retain an older hydration contract.
// Rehydrate raw file-type projections after retiring enum-normalized facts.
// Old cursors must not skip records when the cache compatibility epoch changes.
const BACKFILL_VERSION = 17;
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
  createFetchPage?: (userId: string) => Promise<SoupBackfillFetchPage>;
  /** Access-scope reconciliation requires a fresh full scan after interruption. */
  restartOnRun?: boolean;
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

/** Backfills the entities used most often by Quick Access and primary views. */
export const CORE_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'core-entities',
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
      calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
      channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
      callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
      crmCompanyFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
      foreignEntityFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
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
  createFetchPage: createSharedMailBackfillFetcher,
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

/** Backfills CRM companies and foreign entities. */
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
    },
  },
};

/** Independently checkpointed backfills run serially in priority order. */
export const DEFAULT_SOUP_BACKFILL_LANES = [
  CORE_SOUP_BACKFILL_LANE,
  SIGNAL_EMAIL_FILTER_BACKFILL_LANE,
  NOISE_EMAIL_FILTER_BACKFILL_LANE,
  SHARED_EMAIL_FILTER_BACKFILL_LANE,
  SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
  NOISE_EMAIL_SOUP_BACKFILL_LANE,
  AUXILIARY_SOUP_BACKFILL_LANE,
] as const satisfies readonly SoupBackfillParams[];

export type SoupBackfillCheckpoint = {
  userId: string;
  /** Durable cache data generation that owns this cursor and watermark. */
  storageGeneration: string | null;
  nextCursor: string | null;
  pagesFetched: number;
  completed: boolean;
  /** Start of the pass currently being fetched. */
  scanStartedAt: string | null;
  /** Safe lower bound applied to updatedAt filters on the next pass. */
  updatedSince: string | null;
  /** Wall-clock time when the most recent pass reached its final page. */
  completedAt: string | null;
};

type StoredSoupBackfillCheckpoint = Omit<
  SoupBackfillCheckpoint,
  'storageGeneration' | 'scanStartedAt' | 'updatedSince' | 'completedAt'
> &
  Partial<
    Pick<
      SoupBackfillCheckpoint,
      'storageGeneration' | 'scanStartedAt' | 'updatedSince' | 'completedAt'
    >
  >;

function checkpointKey(userId: string, checkpointId: string): string {
  return `graphql-soup-backfill:v${BACKFILL_VERSION}:${userId}:${checkpointId}`;
}

function initialCheckpoint(
  userId: string,
  storageGeneration: string | null = null
): SoupBackfillCheckpoint {
  return {
    userId,
    storageGeneration,
    nextCursor: null,
    pagesFetched: 0,
    completed: false,
    scanStartedAt: null,
    updatedSince: null,
    completedAt: null,
  };
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isCheckpoint(
  value: unknown,
  userId: string
): value is StoredSoupBackfillCheckpoint {
  if (!value || typeof value !== 'object') return false;

  const checkpoint = value as Partial<SoupBackfillCheckpoint>;
  return (
    checkpoint.userId === userId &&
    (typeof checkpoint.nextCursor === 'string' ||
      checkpoint.nextCursor === null) &&
    typeof checkpoint.pagesFetched === 'number' &&
    typeof checkpoint.completed === 'boolean' &&
    isOptionalString(checkpoint.storageGeneration) &&
    isOptionalString(checkpoint.scanStartedAt) &&
    isOptionalString(checkpoint.updatedSince) &&
    isOptionalString(checkpoint.completedAt)
  );
}

export function loadSoupBackfillCheckpoint(
  userId: string,
  checkpointId = CORE_SOUP_BACKFILL_LANE.checkpointId
): SoupBackfillCheckpoint {
  try {
    const saved = localStorage.getItem(checkpointKey(userId, checkpointId));
    if (!saved) return initialCheckpoint(userId);

    const parsed: unknown = JSON.parse(saved);
    if (!isCheckpoint(parsed, userId)) return initialCheckpoint(userId);

    return {
      ...parsed,
      storageGeneration: parsed.storageGeneration ?? null,
      scanStartedAt: parsed.scanStartedAt ?? null,
      updatedSince: parsed.updatedSince ?? null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    // Restarting from the beginning is safe when storage is unavailable or
    // the saved checkpoint is malformed.
    return initialCheckpoint(userId);
  }
}

function saveSoupBackfillCheckpoint(
  checkpoint: SoupBackfillCheckpoint,
  checkpointId: string
): void {
  try {
    localStorage.setItem(
      checkpointKey(checkpoint.userId, checkpointId),
      JSON.stringify(checkpoint)
    );
  } catch {
    // A failed checkpoint write only causes already-cached pages to be fetched
    // again after restart.
  }
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

export const runSoupBackfill = Effect.fn('runSoupBackfill')(function* (
  userId: string,
  host: SoupBackfillCacheHost,
  params: SoupBackfillParams,
  onCheckpoint?: (checkpoint: SoupBackfillCheckpoint) => void
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
  if (checkpoint.storageGeneration !== storageGeneration) {
    checkpoint = initialCheckpoint(userId, storageGeneration);
  }
  if (params.restartOnRun) {
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
    checkpoint = initialCheckpoint(userId, generation);
    startPass();
  };
  const createPageFetcher = () =>
    params.createFetchPage
      ? Effect.tryPromise(() => params.createFetchPage!(userId))
      : Effect.succeed(params.fetchPage ?? fetchSoupPage);

  // `completed` marks the end of one pass. Start a fresh pass from its stored
  // watermark, while an unfinished checkpoint keeps its cursor.
  if (checkpoint.completed || checkpoint.scanStartedAt === null) {
    yield* Effect.sync(startPass);
  }
  let fetchPage = yield* createPageFetcher();

  while (true) {
    const beforeFetchGeneration = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    if (checkpoint.storageGeneration !== beforeFetchGeneration) {
      yield* Effect.sync(() => restartForGeneration(beforeFetchGeneration));
      fetchPage = yield* createPageFetcher();
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
      fetchPage = yield* createPageFetcher();
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

        yield* runSoupBackfill(userId, host, lane, (checkpoint) => {
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
        }).pipe(
          Effect.retry({
            times: BACKFILL_RETRY_COUNT,
            schedule: BACKFILL_RETRY_SCHEDULE,
          }),
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() => {
                const checkpoint = loadSoupBackfillCheckpoint(
                  userId,
                  lane.checkpointId
                );
                recordSoupBackfillTelemetry({
                  checkpointId: lane.checkpointId,
                  durationMs: Date.now() - startedAt,
                  pagesFetched,
                  state: 'failed',
                  totalPagesFetched: checkpoint.pagesFetched,
                });
                console.warn(
                  '[graphql-soup-backfill] lane failed after retries',
                  { checkpointId: lane.checkpointId, error }
                );
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
 * Runs the checkpointed backfill Effect while this tab owns leadership.
 * Interrupting the fiber cancels cache readiness waits, active fetches, and
 * inter-page sleeps. Engine handoffs resume durable checkpoints; only loss of
 * stored cache data resets cursors so they cannot point past wiped records.
 */
/** Runs the signed-in user's soup backfills; waits while `userId` is unknown. */
export function useSoupBackfills(userId: Accessor<string | undefined>): void {
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);
  const isLeader = createTabLeaderSignal(
    `graphql-soup-backfill:v${BACKFILL_VERSION}:coordinator`
  );
  const [cacheHost, setCacheHost] = createSignal<CacheHost>();
  const [cacheGeneration, setCacheGeneration] = createSignal(0);

  createEffect(() => {
    if (!ENABLE_GRAPHQL_BACKFILL || !graphqlSoupFlag().enabled || !isLeader()) {
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

    const fiber = Effect.runFork(
      runSoupBackfills(id, host).pipe(Effect.ignore)
    );
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
