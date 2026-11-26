import { ENABLE_GRAPHQL_BACKFILL } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import {
  type GraphqlEmailExpr,
  SoupBackfillDocument,
  type SoupChannelDirectoryBackfillDocument,
  SoupMailBackfillDocument,
  SoupSharedMailBackfillDocument,
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
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { CHANNEL_DIRECTORY_LANE } from '../channel/directory-lane';
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
  initialSoupBackfillCheckpoint,
  loadSoupBackfillCheckpoint as loadCheckpoint,
  markSoupBackfillLaneFailed,
  readSoupBackfillCheckpoint,
  type SoupBackfillCheckpoint,
  saveSoupBackfillCheckpoint,
} from './backfill-checkpoint';
import {
  BACKFILL_VERSION,
  type SoupBackfillLane,
  soupBackfillCoordinatorKey,
  soupBackfillLaneContract,
  soupBackfillLaneLocks,
} from './backfill-contract';

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

/** The Soup operations a backfill lane can page through. */
export type SoupBackfillOperation =
  | typeof SoupBackfillDocument
  | typeof SoupChannelDirectoryBackfillDocument
  | typeof SoupMailBackfillDocument
  | typeof SoupSharedMailBackfillDocument;

const fetchOperation =
  (operation: SoupBackfillOperation): SoupBackfillFetchPage =>
  (input, options) =>
    hydrateGraphqlSoup(operation, { input }, options);

export type SoupBackfillParams = {
  /** Stable checkpoint namespace; the lane's contract keys its progress. */
  checkpointId: string;
  /** The operation every page sends. Part of the lane's contract. */
  operation: SoupBackfillOperation;
  /** Replaces the network call for `operation`, as tests do. */
  fetchPage?: SoupBackfillFetchPage;
  /** Wraps the operation's fetch with per-scan membership evidence (never
   * shared across users or retries). `signal` aborts the setup. */
  createFetchPage?: (
    userId: string,
    fetch: SoupBackfillFetchPage,
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
  /** Bump when what this lane must refetch changes in a way its operation,
   * input and flags do not show, such as a projection needing fields the cache
   * lacks or a new completion guarantee: only this lane restarts. See
   * `soupBackfillLaneContract`. */
  contractVersion?: number;
};

/**
 * Every channel the viewer can see, ahead of the mixed core lane, so the cache
 * holds the whole channel list soon after login rather than once documents and
 * chats have paged through with it.
 */
export const CHANNEL_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  ...CHANNEL_DIRECTORY_LANE,
  createFetchPage: channelDirectoryBackfillFetcher,
  // A retry goes on with the fetcher that saw the pages before its cursor,
  // so one failed page does not cost a large account its whole pass. Not
  // when that fetcher could not prove the pass: it would fail again.
  resumesAfter: (error) => !(error instanceof ChannelDirectoryPassUnproven),
  // One request per 100 channels: 2 s spacing takes minutes on a large account.
  pageDelayMs: 250,
};

/** Backfills documents, chats, and folders for Quick Access and primary views. */
export const CORE_SOUP_BACKFILL_LANE: SoupBackfillParams = {
  checkpointId: 'core-entities',
  operation: SoupBackfillDocument,
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
  operation: SoupBackfillDocument,
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
  operation: SoupBackfillDocument,
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
  operation: SoupMailBackfillDocument,
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
  operation: SoupSharedMailBackfillDocument,
  // Its second parameter is the cache host, not the run's signal.
  createFetchPage: (userId, fetch) =>
    createSharedMailBackfillFetcher(userId, undefined, fetch),
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
  operation: SoupBackfillDocument,
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
  lane: SoupBackfillLane = CORE_SOUP_BACKFILL_LANE
): SoupBackfillCheckpoint {
  return loadCheckpoint(userId, lane);
}

type SoupBackfillTelemetryState =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

function recordSoupBackfillTelemetry(input: {
  lane: SoupBackfillParams;
  durationMs?: number;
  /** Time spent waiting for another tab to finish this lane. */
  lockWaitMs?: number;
  pagesFetched: number;
  state: SoupBackfillTelemetryState;
  totalPagesFetched: number;
}): void {
  try {
    const span = Telemetry.anonymousSpan('graphql_cache.backfill');
    span.setAttr('cache.backfill_lane', input.lane.checkpointId);
    span.setAttr('cache.backfill_version', BACKFILL_VERSION);
    span.setAttr(
      'cache.backfill_contract',
      soupBackfillLaneContract(input.lane)
    );
    span.setAttr('cache.backfill_state', input.state);
    span.setAttr('cache.backfill_pages_fetched', input.pagesFetched);
    span.setAttr('cache.backfill_total_pages_fetched', input.totalPagesFetched);
    if (input.durationMs !== undefined) {
      span.setAttr('cache.duration_ms', input.durationMs);
    }
    if (input.lockWaitMs !== undefined) {
      span.setAttr('cache.backfill_lock_wait_ms', input.lockWaitMs);
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
  /** The page fetcher of the pass the attempt was on, and the checkpoint the
   * attempt last saved with it. */
  pageFetcher?: {
    fetchPage: SoupBackfillFetchPage;
    saved: SoupBackfillCheckpoint;
  };
};

/** What a failed Effect step threw. */
const thrownBy = (error: unknown) =>
  Cause.isUnknownError(error) ? error.cause : error;

/**
 * Whether `checkpoint` is the one a failed attempt last saved, in a pass it
 * left unfinished: the retry then goes on from its cursor with the fetcher
 * that read the pages before it. A checkpoint another tab saved meanwhile
 * holds pages that fetcher never saw, so the retry takes a new one.
 */
function resumesWith(
  checkpoint: SoupBackfillCheckpoint,
  retry: SoupBackfillRetry | undefined
): boolean {
  const saved = retry?.pageFetcher?.saved;
  return (
    saved !== undefined &&
    !checkpoint.completed &&
    checkpoint.scanStartedAt !== null &&
    checkpoint.storageGeneration === saved.storageGeneration &&
    checkpoint.scanStartedAt === saved.scanStartedAt &&
    checkpoint.nextCursor === saved.nextCursor &&
    checkpoint.pagesFetched === saved.pagesFetched
  );
}

type SoupBackfillRunOptions = {
  /** After each saved page. */
  onCheckpoint?: (checkpoint: SoupBackfillCheckpoint) => void;
  /** As the lane starts, with how long its lock took (none without locks). */
  onStarted?: (lockWaitMs: number | undefined) => void;
  /** Run when the run fails, while it still holds the lane's locks. */
  onFailed?: () => Effect.Effect<void>;
  /** Leave the lane, returning false, while another tab is running it. */
  ifAvailable?: boolean;
  /**
   * The lane's checkpoint as stored when this tab left it to another tab:
   * skip the lane if that tab has since saved a completed pass.
   */
  revisit?: { saved: string | null };
  /** Asked once the lane's locks are held; the lane runs only if it agrees. */
  claim?: () => boolean;
  /** Kept across the attempts of a lane whose retries can resume. */
  retry?: SoupBackfillRetry;
};

/**
 * Waits for the browser-wide lock `name` and succeeds with its release, or
 * with null when `ifAvailable` and another tab holds it.
 */
const acquireBrowserLock = (
  locks: LockManager,
  name: string,
  ifAvailable: boolean
) =>
  Effect.callback<(() => void) | null, Error>((resume, signal) => {
    const request = async () => {
      try {
        await locks.request(
          name,
          // The Locks API refuses a signal beside ifAvailable, which never waits.
          ifAvailable ? { ifAvailable } : { signal },
          (lock) =>
            new Promise<void>((release) => {
              if (lock === null) {
                release();
                resume(Effect.succeed(null));
              }
              // Granted as the waiter was interrupted: give it straight back.
              else if (signal.aborted) release();
              else resume(Effect.succeed(() => release()));
            })
        );
      } catch (error) {
        if (!signal.aborted) {
          resume(
            Effect.fail(new Error('backfill lock failed', { cause: error }))
          );
        }
      }
    };
    fireAndForget(request(), 'soup-backfill-lock');
  });

/**
 * Runs `effect` holding the browser-wide lock `name`, or succeeds with false,
 * without running it, when `ifAvailable` finds the lock held. Waiting is
 * interruptible; from the grant on, release always runs.
 */
function withBrowserLock<E, R>(
  locks: LockManager,
  name: string,
  ifAvailable: boolean,
  effect: Effect.Effect<boolean, E, R>
): Effect.Effect<boolean, E | Error, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(
      restore(acquireBrowserLock(locks, name, ifAvailable)),
      (release) =>
        release === null
          ? Effect.succeed(false)
          : restore(effect).pipe(Effect.ensuring(Effect.sync(release)))
    )
  );
}

/**
 * Runs `effect` holding a lane's locks (`soupBackfillLaneLocks`), so two tabs,
 * of one build or of two that share the lane's contract, never load, scan and
 * save the same checkpoint at once: the second resumes where the first stopped
 * instead of fetching the same pages beside it and saving an older cursor over
 * a newer one. Without the Locks API, as in unit tests, it runs unlocked.
 * Succeeds with false, without running, when `ifAvailable` finds one held or
 * `claim` declines.
 */
function withLaneLocks<E, R>(
  names: readonly string[],
  effect: Effect.Effect<void, E, R>,
  options: SoupBackfillRunOptions
): Effect.Effect<boolean, E | Error, R> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return Effect.suspend(() => {
    const requestedAt = Date.now();
    const run = Effect.suspend(() => {
      // Another lane took this tab's turn while these locks were awaited.
      if (options.claim && !options.claim()) return Effect.succeed(false);
      options.onStarted?.(locks ? Date.now() - requestedAt : undefined);
      return effect.pipe(Effect.as(true));
    });
    if (!locks) return run;
    return names.reduceRight<Effect.Effect<boolean, E | Error, R>>(
      (inner, name) =>
        withBrowserLock(locks, name, options.ifAvailable === true, inner),
      run
    );
  });
}

/**
 * The checkpoint a run starts from: the saved one in the current storage
 * generation, without the cursor of the last run for a lane that restarts
 * every run, or null when another tab completed the pass this run waited for:
 * the checkpoint is completed and is no longer the one stored when this tab
 * left the lane. Comparing what was stored, not times, keeps a completion
 * stamped by a skewed clock from passing for a new one. A lane that restarts
 * every run is never skipped: each run's scan is its point. Such a lane
 * keeps its cursor only for a retry that resumes the pass (`resumesWith`).
 */
function loadRunCheckpoint(
  userId: string,
  params: SoupBackfillParams,
  storageGeneration: string,
  options: Pick<SoupBackfillRunOptions, 'revisit' | 'retry'>
): SoupBackfillCheckpoint | null {
  const { stored, checkpoint: saved } = readSoupBackfillCheckpoint(
    userId,
    params
  );
  const checkpoint =
    saved.storageGeneration === storageGeneration
      ? saved
      : initialSoupBackfillCheckpoint(userId, storageGeneration);
  if (
    options.revisit !== undefined &&
    !params.restartOnRun &&
    checkpoint.completed &&
    stored !== options.revisit.saved
  ) {
    return null;
  }
  return params.restartOnRun && !resumesWith(checkpoint, options.retry)
    ? {
        ...checkpoint,
        nextCursor: null,
        completed: false,
        pagesFetched: 0,
        scanStartedAt: null,
      }
    : checkpoint;
}

/** The checkpoint after saving a page that returned `nextCursor`. */
function checkpointAfterPage(
  checkpoint: SoupBackfillCheckpoint,
  nextCursor: string | null | undefined,
  params: SoupBackfillParams
): SoupBackfillCheckpoint {
  const advanced = {
    ...checkpoint,
    nextCursor: nextCursor ?? null,
    pagesFetched: checkpoint.pagesFetched + 1,
  };
  if (nextCursor != null) return advanced;
  // Use the pass start rather than its completion time so updates made while
  // this pass was running are included next time.
  const updatedSince = checkpoint.scanStartedAt ?? checkpoint.updatedSince;
  const passCompletedAt = new Date().toISOString();
  // Only a never-completed full scan needs the additional watermark pass. An
  // interrupted catch-up already has updatedSince and resumes normally.
  if (
    params.catchUpAfterInitialPass === true &&
    checkpoint.updatedSince === null
  ) {
    // Atomically persist the required catch-up as in progress instead of
    // exposing a completed lane between the two passes. It filters from the
    // full pass start, with that pass's completion as its own watermark.
    return {
      ...advanced,
      completed: false,
      updatedSince,
      completedAt: null,
      scanStartedAt: passCompletedAt,
    };
  }
  return {
    ...advanced,
    completed: true,
    updatedSince,
    completedAt: passCompletedAt,
    scanStartedAt: null,
  };
}

/**
 * The checkpoint a run starts from (`loadRunCheckpoint`), or null to skip the
 * lane. A skip trusts a completion read after the storage generation was
 * sampled, so the generation is sampled again: after a reset in between, the
 * lane runs in the new generation instead.
 */
const startingCheckpoint = (
  userId: string,
  host: SoupBackfillCacheHost,
  params: SoupBackfillParams,
  options: SoupBackfillRunOptions
) =>
  Effect.gen(function* () {
    const generation = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    const loaded = loadRunCheckpoint(userId, params, generation, options);
    if (loaded !== null) return loaded;
    const current = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    return current === generation
      ? null
      : loadRunCheckpoint(userId, params, current, {});
  });

const runUnlockedSoupBackfill = Effect.fn('runSoupBackfill')(function* (
  userId: string,
  host: SoupBackfillCacheHost,
  params: SoupBackfillParams,
  options: SoupBackfillRunOptions
) {
  // Await storage readiness before reading a cursor. Generation notifications
  // may predate this runner or belong to another tab, so they cannot prove that
  // a saved continuation still refers to records in the current database.
  const loaded = yield* startingCheckpoint(userId, host, params, options);
  // Another tab finished the pass this one waited for.
  if (loaded === null) return;
  let checkpoint = loaded;
  const startPass = () => {
    checkpoint = {
      ...checkpoint,
      nextCursor: checkpoint.completed ? null : checkpoint.nextCursor,
      completed: false,
      scanStartedAt: new Date().toISOString(),
    };
    saveSoupBackfillCheckpoint(checkpoint, params);
  };
  const restartForGeneration = (generation: string) => {
    checkpoint = initialSoupBackfillCheckpoint(userId, generation);
    startPass();
  };
  // The fetcher for the pass `checkpoint` is on: the one a failed attempt
  // kept when this run resumes its pass, else one made afresh for the scan.
  const createPageFetcher = Effect.fnUntraced(function* () {
    const { retry } = options;
    const kept = retry?.pageFetcher;
    if (kept && resumesWith(checkpoint, retry)) return kept.fetchPage;
    if (retry) retry.pageFetcher = undefined;
    const fetch = params.fetchPage ?? fetchOperation(params.operation);
    const create = params.createFetchPage;
    const fetchPage = create
      ? yield* Effect.tryPromise((signal) => create(userId, fetch, signal))
      : fetch;
    if (retry) retry.pageFetcher = { fetchPage, saved: checkpoint };
    return fetchPage;
  });

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
      fetchPage = yield* createPageFetcher();
      continue;
    }

    checkpoint = checkpointAfterPage(checkpoint, page.nextCursor, params);
    yield* Effect.sync(() => {
      saveSoupBackfillCheckpoint(checkpoint, params);
      if (options.retry?.pageFetcher) {
        options.retry.pageFetcher.saved = checkpoint;
      }
      options.onCheckpoint?.(checkpoint);
    });

    if (checkpoint.completed) return;
    // The terminal page transitions directly into the narrowed catch-up pass.
    if (checkpoint.nextCursor !== null) {
      yield* Effect.sleep(params.pageDelayMs ?? PAGE_DELAY_MS);
    }
  }
});

/**
 * Runs one lane until its pass completes, holding its checkpoint's lock.
 * Succeeds with false, without running, when `ifAvailable` finds the lane
 * running in another tab.
 */
export const runSoupBackfill = (
  userId: string,
  host: SoupBackfillCacheHost,
  params: SoupBackfillParams,
  options: SoupBackfillRunOptions = {}
) =>
  withLaneLocks(
    soupBackfillLaneLocks(userId, params),
    runUnlockedSoupBackfill(userId, host, params, options).pipe(
      Effect.tapError(() => options.onFailed?.() ?? Effect.void)
    ),
    options
  );

/** Runs one lane with its telemetry and retries; false when it was left. */
const runTrackedSoupBackfill = (
  userId: string,
  host: SoupBackfillCacheHost,
  lane: SoupBackfillParams,
  attempt: Pick<SoupBackfillRunOptions, 'ifAvailable' | 'revisit' | 'claim'>
) =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    let started = false;
    let pagesFetched = 0;
    let lockWaitMs: number | undefined;
    // The lane's stored checkpoint when the last attempt failed.
    let leftStored: string | null = null;
    let failures = 0;
    let marked = false;
    // Marks the lane failed in the cache's current generation, the one
    // readers check (a lane that failed before it saved a page in it left
    // only an older generation in its checkpoint), if `still` holds after
    // that generation is read.
    const markFailed = (still: () => boolean) =>
      Effect.gen(function* () {
        const { storageGeneration } = loadSoupBackfillCheckpoint(userId, lane);
        const generation = yield* Effect.tryPromise(() =>
          host.currentStorageGeneration()
        ).pipe(Effect.orElseSucceed(() => storageGeneration));
        if (generation !== null && still()) {
          markSoupBackfillLaneFailed(userId, lane, generation);
        }
      });
    // Kept across the attempts of a lane whose retries can resume.
    const retry: SoupBackfillRetry | undefined = lane.resumesAfter
      ? {}
      : undefined;
    const record = (
      state: SoupBackfillTelemetryState,
      totalPagesFetched: number
    ) =>
      recordSoupBackfillTelemetry({
        lane,
        ...(state === 'started' ? {} : { durationMs: Date.now() - startedAt }),
        lockWaitMs,
        pagesFetched,
        state,
        totalPagesFetched,
      });
    const ran = yield* runSoupBackfill(userId, host, lane, {
      ...attempt,
      retry,
      onStarted: (waitMs) => {
        if (waitMs !== undefined) lockWaitMs = (lockWaitMs ?? 0) + waitMs;
        if (started) return;
        started = true;
        record(
          'started',
          loadSoupBackfillCheckpoint(userId, lane).pagesFetched
        );
      },
      onFailed: () =>
        Effect.suspend(() => {
          // No other tab can save the lane while this one holds it.
          leftStored = readSoupBackfillCheckpoint(userId, lane).stored;
          if (failures < BACKFILL_RETRY_COUNT) return Effect.void;
          // The last attempt marks the lane failed before letting go of it,
          // so the mark can't land over the progress of a tab that takes the
          // lane next: that tab's first save clears it.
          marked = true;
          return markFailed(() => true);
        }),
      onCheckpoint: (checkpoint) => {
        pagesFetched += 1;
        if (
          !checkpoint.completed &&
          pagesFetched % BACKFILL_PROGRESS_PAGE_INTERVAL === 0
        ) {
          record('progress', checkpoint.pagesFetched);
        }
      },
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          failures += 1;
          if (retry && !lane.resumesAfter?.(thrownBy(error))) {
            retry.pageFetcher = undefined;
          }
        })
      ),
      Effect.retry({
        times: BACKFILL_RETRY_COUNT,
        schedule: BACKFILL_RETRY_SCHEDULE,
      }),
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            record(
              'failed',
              loadSoupBackfillCheckpoint(userId, lane).pagesFetched
            );
            // Readers waiting for the lane to finish stop waiting. A last
            // attempt that failed taking the lane's locks left the mark to
            // here, unless another tab saved the lane since this one last held
            // it: that tab reports its own outcome.
            if (!marked) {
              yield* markFailed(
                () =>
                  readSoupBackfillCheckpoint(userId, lane).stored === leftStored
              );
            }
            console.warn('[graphql-soup-backfill] lane failed after retries', {
              checkpointId: lane.checkpointId,
              error,
            });
            return true;
          }),
        onSuccess: (ran) =>
          Effect.sync(() => {
            // A lane another tab completed while this one waited records
            // completion with no pages fetched.
            if (ran) {
              record(
                'completed',
                loadSoupBackfillCheckpoint(userId, lane).pagesFetched
              );
            }
            return ran;
          }),
      })
    );
    return ran;
  });

/**
 * Waits for the locks of every lane in `left` at once and runs the first lane
 * to hold all of its own; the others stop waiting. Succeeds with the indexes
 * of the lanes done: that lane, and any that gave up on their locks meanwhile.
 * A lane that gives up never ends the race while another may still be granted,
 * so the others keep their places in the lock queues; the race ends once all
 * gave up. The lane holding the turn ends it however it ends, and a defect in
 * any lane ends the suite, as it would in the first pass.
 */
const runFirstFreeLane = (
  userId: string,
  host: SoupBackfillCacheHost,
  left: readonly { lane: SoupBackfillParams; saved: string | null }[]
) =>
  Effect.gen(function* () {
    let turn: number | null = null;
    const gaveUp: number[] = [];
    const exit = yield* Effect.raceAll(
      left.map(({ lane, saved }, index) =>
        runTrackedSoupBackfill(userId, host, lane, {
          revisit: { saved },
          // A lane granted after another took the turn gives its locks back.
          claim: () => {
            if (turn === null) turn = index;
            return turn === index;
          },
        }).pipe(
          Effect.exit,
          Effect.flatMap((exit) => {
            if (turn === index || Exit.isFailure(exit)) {
              return Effect.succeed(exit);
            }
            // True: it gave up on its locks after its retries. False: it
            // declined, and asks again once the lane holding the turn is done.
            if (exit.value) gaveUp.push(index);
            return gaveUp.length === left.length
              ? Effect.succeed(exit)
              : Effect.never;
          })
        )
      )
    );
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    return turn === null ? gaveUp : [turn, ...gaveUp];
  });

/**
 * Runs each backfill lane to completion before starting the next lane. A lane
 * another tab is running is left to it. Once the others are done, the left
 * lanes run one at a time, each as soon as its locks are free, so a stalled
 * tab holds back only the lanes it holds. A left lane that tab completed in
 * the meantime is skipped, unless it restarts every run.
 */
export const runSoupBackfills = Effect.fn('runSoupBackfills')(function* (
  userId: string,
  host: SoupBackfillCacheHost,
  lanes: readonly SoupBackfillParams[] = DEFAULT_SOUP_BACKFILL_LANES
) {
  const left: { lane: SoupBackfillParams; saved: string | null }[] = [];
  yield* Effect.forEach(
    lanes,
    (lane) => {
      const saved = readSoupBackfillCheckpoint(userId, lane).stored;
      return runTrackedSoupBackfill(userId, host, lane, {
        ifAvailable: true,
      }).pipe(
        Effect.tap((ran) =>
          Effect.sync(() => {
            if (!ran) left.push({ lane, saved });
          })
        )
      );
    },
    { concurrency: 1, discard: true }
  );
  let waiting = left;
  while (waiting.length > 0) {
    const finished = yield* runFirstFreeLane(userId, host, waiting);
    waiting = waiting.filter((_left, index) => !finished.includes(index));
  }
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
/** Runs the signed-in user's soup backfills; waits while `userId` is unknown.
 * `directoryChannels` feeds contact facts: the complete channel directory. */
export function useSoupBackfills(
  userId: Accessor<string | undefined>,
  directoryChannels: Accessor<readonly ContextChannel[] | undefined>
): void {
  const isLeader = createTabLeaderSignal(
    soupBackfillCoordinatorKey(DEFAULT_SOUP_BACKFILL_LANES)
  );
  // Sender metadata must be durable before the first composer is opened.
  // This small catalog runs alongside the paged backfill, never behind it.
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

    const fiber = Effect.runFork(
      runSoupBackfills(id, host).pipe(Effect.ignore)
    );
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
