import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_BACKFILL,
  enableGraphqlSoup,
} from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { SoupBackfillDocument } from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInitialInput,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  hydrateGraphqlSoup,
} from '@service-storage/graphql-soup';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';
import { createEffect, createSignal, onCleanup } from 'solid-js';

// Bump when a default backfill input or completion guarantee changes so
// persisted cursors cannot retain an older hydration contract.
const BACKFILL_VERSION = 7;
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
  /** Soup input shared by every page. The backfill manages the cursor. */
  input: GraphqlSoupInitialInput;
  /** Delay between successful pages. Defaults to two seconds. */
  pageDelayMs?: number;
  /** Immediately follows the initial full scan with its watermark pass. */
  catchUpAfterInitialPass?: boolean;
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
 * Backfills email threads and the first message page used by the thread view
 * while excluding every other entity variant with an impossible id filter.
 */
export const EMAIL_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'email-thread-pages',
  fetchPage: fetchEmailContentPage,
  // A long full scan can skip threads created, viewed, or updated after its
  // VIEWED_UPDATED cursor has passed them. Consume the recorded watermark
  // before reporting this lane complete.
  catchUpAfterInitialPass: true,
  input: {
    limit: EMAIL_CONTENT_PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
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
  EMAIL_SOUP_BACKFILL_LANE,
  AUXILIARY_SOUP_BACKFILL_LANE,
] as const satisfies readonly SoupBackfillParams[];

export type SoupBackfillCheckpoint = {
  userId: string;
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
  'scanStartedAt' | 'updatedSince' | 'completedAt'
> &
  Partial<
    Pick<
      SoupBackfillCheckpoint,
      'scanStartedAt' | 'updatedSince' | 'completedAt'
    >
  >;

function checkpointKey(userId: string, checkpointId: string): string {
  return `graphql-soup-backfill:v${BACKFILL_VERSION}:${userId}:${checkpointId}`;
}

function initialCheckpoint(userId: string): SoupBackfillCheckpoint {
  return {
    userId,
    nextCursor: null,
    pagesFetched: 0,
    completed: false,
    scanStartedAt: null,
    updatedSince: null,
    completedAt: null,
  };
}

function isOptionalTimestamp(value: unknown): boolean {
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
    isOptionalTimestamp(checkpoint.scanStartedAt) &&
    isOptionalTimestamp(checkpoint.updatedSince) &&
    isOptionalTimestamp(checkpoint.completedAt)
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

export function resetSoupBackfillCheckpoint(
  userId: string,
  checkpointId = CORE_SOUP_BACKFILL_LANE.checkpointId
): void {
  try {
    localStorage.removeItem(checkpointKey(userId, checkpointId));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function resetDefaultSoupBackfillCheckpoints(userId: string): void {
  for (const lane of DEFAULT_SOUP_BACKFILL_LANES) {
    resetSoupBackfillCheckpoint(userId, lane.checkpointId);
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

  const emailUpdatedAt = {
    literal: { updatedAt: { gte: updatedSince } },
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
        tree: and(filters.emailFilter?.tree, emailUpdatedAt),
      },
    },
  };
}

export const runSoupBackfill = Effect.fn('runSoupBackfill')(function* (
  userId: string,
  params: SoupBackfillParams,
  onCheckpoint?: (checkpoint: SoupBackfillCheckpoint) => void
) {
  let checkpoint = yield* Effect.sync(() =>
    loadSoupBackfillCheckpoint(userId, params.checkpointId)
  );
  // Only a never-completed full scan needs the additional watermark pass. An
  // interrupted catch-up already has updatedSince and resumes normally.
  let catchUpPassPending =
    params.catchUpAfterInitialPass === true && checkpoint.updatedSince === null;

  const startPass = () => {
    checkpoint = {
      ...checkpoint,
      nextCursor: checkpoint.completed ? null : checkpoint.nextCursor,
      completed: false,
      scanStartedAt: new Date().toISOString(),
    };
    saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);
  };

  // `completed` marks the end of one pass. Start a fresh pass from its stored
  // watermark, while an unfinished checkpoint keeps its cursor.
  if (checkpoint.completed || checkpoint.scanStartedAt === null) {
    yield* Effect.sync(startPass);
  }

  const fetchPage = params.fetchPage ?? fetchSoupPage;

  while (true) {
    const passInput = withUpdatedSince(params.input, checkpoint.updatedSince);

    while (true) {
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

      const passCompleted = page.nextCursor == null;
      const transitionToCatchUp = passCompleted && catchUpPassPending;
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
                updatedSince:
                  checkpoint.scanStartedAt ?? checkpoint.updatedSince,
                completedAt: null,
                scanStartedAt: passCompletedAt,
              }
            : {
                // Use the pass start rather than its completion time so updates
                // made while this pass was running are included next time.
                updatedSince:
                  checkpoint.scanStartedAt ?? checkpoint.updatedSince,
                completedAt: passCompletedAt,
                scanStartedAt: null,
              }
          : {}),
      };
      if (transitionToCatchUp) catchUpPassPending = false;
      yield* Effect.sync(() => {
        saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);
        onCheckpoint?.(checkpoint);
      });

      if (passCompleted) break;

      yield* Effect.sleep(params.pageDelayMs ?? PAGE_DELAY_MS);
    }

    if (checkpoint.completed) return;
    // The only incomplete terminal-page state is the atomic transition above.
    // Continue directly into its narrowed catch-up pass.
  }
});

/** Runs each backfill lane to completion before starting the next lane. */
export const runSoupBackfills = Effect.fn('runSoupBackfills')(function* (
  userId: string,
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
        const initialPagesFetched = initialCheckpoint.pagesFetched;
        yield* Effect.sync(() =>
          recordSoupBackfillTelemetry({
            checkpointId: lane.checkpointId,
            pagesFetched: 0,
            state: 'started',
            totalPagesFetched: initialPagesFetched,
          })
        );

        yield* runSoupBackfill(userId, lane, (checkpoint) => {
          const pagesFetched = checkpoint.pagesFetched - initialPagesFetched;
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
                  pagesFetched: checkpoint.pagesFetched - initialPagesFetched,
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
                  pagesFetched: checkpoint.pagesFetched - initialPagesFetched,
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
  return host === undefined
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
 * inter-page sleeps. A replacement cache generation resets the external
 * cursors before restarting so they can never point past wiped cache data.
 */
export function useSoupBackfills(userId: string): void {
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
      resetDefaultSoupBackfillCheckpoints(userId);
      setCacheGeneration((generation) => generation + 1);
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    if (!cacheHost()) return;
    cacheGeneration();

    const fiber = Effect.runFork(runSoupBackfills(userId).pipe(Effect.ignore));
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
