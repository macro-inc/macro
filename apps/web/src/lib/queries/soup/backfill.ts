import { ENABLE_GRAPHQL_BACKFILL } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
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
import { createEffect, onCleanup } from 'solid-js';

// Bump when a default backfill input changes so persisted opaque cursors
// cannot retain the previous server-side filters.
const BACKFILL_VERSION = 6;
const PAGE_LIMIT = 100;
// Five threads × twenty messages reaches the backend's 100-message cap.
const EMAIL_CONTENT_PAGE_LIMIT = 5;
const PAGE_DELAY_MS = 2_000;
const BACKFILL_RETRY_COUNT = 5;
const BACKFILL_RETRY_SCHEDULE = Schedule.exponential('1 second');
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
  // Restart completed legacy newest-message checkpoints with the new shape.
  checkpointId: 'email-thread-pages',
  fetchPage: fetchEmailContentPage,
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
  params: SoupBackfillParams
) {
  let checkpoint = yield* Effect.sync(() =>
    loadSoupBackfillCheckpoint(userId, params.checkpointId)
  );

  // `completed` only marks the end of one pass. A later invocation resets
  // pagination so it can run another pass narrowed by the stored updatedSince.
  // An unfinished checkpoint without scanStartedAt keeps its cursor and only
  // initializes the timestamp needed for the next watermark.
  if (checkpoint.completed || checkpoint.scanStartedAt === null) {
    checkpoint = {
      ...checkpoint,
      nextCursor: checkpoint.completed ? null : checkpoint.nextCursor,
      completed: false,
      scanStartedAt: new Date().toISOString(),
    };
    yield* Effect.sync(() =>
      saveSoupBackfillCheckpoint(checkpoint, params.checkpointId)
    );
  }

  const passInput = withUpdatedSince(params.input, checkpoint.updatedSince);
  const fetchPage = params.fetchPage ?? fetchSoupPage;

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
    // Hydration returns only the cursor projection. Cache-only entity payloads
    // are persisted without being materialized back into this page.
    const page = yield* Effect.tryPromise((signal) =>
      fetchPage(input, { signal })
    );

    const completed = page.nextCursor == null;
    checkpoint = {
      ...checkpoint,
      nextCursor: page.nextCursor ?? null,
      pagesFetched: checkpoint.pagesFetched + 1,
      completed,
      ...(completed
        ? {
            // Use the pass start rather than its completion time so updates
            // made while this pass was running are included next time.
            updatedSince: checkpoint.scanStartedAt ?? checkpoint.updatedSince,
            completedAt: new Date().toISOString(),
            scanStartedAt: null,
          }
        : {}),
    };
    yield* Effect.sync(() =>
      saveSoupBackfillCheckpoint(checkpoint, params.checkpointId)
    );

    if (checkpoint.completed) return;

    yield* Effect.sleep(params.pageDelayMs ?? PAGE_DELAY_MS);
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
      runSoupBackfill(userId, lane).pipe(
        Effect.retry({
          times: BACKFILL_RETRY_COUNT,
          schedule: BACKFILL_RETRY_SCHEDULE,
        }),
        Effect.ignore
      ),
    { concurrency: 1, discard: true }
  );
});

/**
 * Runs the checkpointed backfill Effect while this tab owns leadership.
 * Interrupting the fiber cancels the active fetch or inter-page sleep.
 */
export function useSoupBackfills(userId: string): void {
  const isLeader = createTabLeaderSignal(
    `graphql-soup-backfill:v${BACKFILL_VERSION}:coordinator`
  );

  createEffect(() => {
    if (
      !ENABLE_GRAPHQL_BACKFILL ||
      getGraphqlSoupCacheHost() === undefined ||
      !isLeader()
    ) {
      return;
    }

    const fiber = Effect.runFork(runSoupBackfills(userId));
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
