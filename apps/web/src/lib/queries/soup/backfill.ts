import {
  fetchGraphqlSoup,
  type GraphqlSoupInput,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const BACKFILL_VERSION = 1;
const PAGE_LIMIT = 250;
const PAGE_DELAY_MS = 2_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const EXCLUDED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

export type SoupBackfillParams = {
  /** Stable checkpoint namespace. Change it when the input changes. */
  checkpointId: string;
  /** Soup input shared by every page. The backfill manages the cursor. */
  input: Omit<GraphqlSoupInput, 'cursor'>;
  /** Delay between successful pages. Defaults to five seconds. */
  pageDelayMs?: number;
};

export const ALL_SOUP_BACKFILL_PARAMS: SoupBackfillParams = {
  checkpointId: 'all',
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
      emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
      channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
    },
  },
};

/**
 * Fetches email threads while excluding every other entity variant with an
 * impossible id filter.
 */
export const EMAIL_SOUP_BACKFILL_PARAMS: SoupBackfillParams = {
  checkpointId: 'email-all',
  input: {
    limit: PAGE_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
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

export type SoupBackfillCheckpoint = {
  userId: string;
  nextCursor: string | null;
  pagesFetched: number;
  itemsFetched: number;
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
  const baseKey = `graphql-soup-backfill:v${BACKFILL_VERSION}:${userId}`;
  // Preserve the original all-Soup checkpoint key.
  return checkpointId === ALL_SOUP_BACKFILL_PARAMS.checkpointId
    ? baseKey
    : `${baseKey}:${checkpointId}`;
}

function initialCheckpoint(userId: string): SoupBackfillCheckpoint {
  return {
    userId,
    nextCursor: null,
    pagesFetched: 0,
    itemsFetched: 0,
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
    typeof checkpoint.itemsFetched === 'number' &&
    typeof checkpoint.completed === 'boolean' &&
    isOptionalTimestamp(checkpoint.scanStartedAt) &&
    isOptionalTimestamp(checkpoint.updatedSince) &&
    isOptionalTimestamp(checkpoint.completedAt)
  );
}

export function loadSoupBackfillCheckpoint(
  userId: string,
  checkpointId = ALL_SOUP_BACKFILL_PARAMS.checkpointId
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
  checkpointId = ALL_SOUP_BACKFILL_PARAMS.checkpointId
): void {
  try {
    localStorage.removeItem(checkpointKey(userId, checkpointId));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(abortReason(signal));
      },
      { once: true }
    );
  });
}

/** Retry after 1s, 2s, 4s, 8s, and so on, capped at 30s. */
function backfillRetryDelay(attempt: number): number {
  const exponentialDelay = INITIAL_RETRY_DELAY_MS * 2 ** attempt;
  return Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
}

function and<T>(left: T | null | undefined, right: T): T {
  return left ? ({ and: { left, right } } as T) : right;
}

/**
 * Restricts entity types that expose an updatedAt filter while preserving any
 * caller-provided filters. Other entity types continue to be fetched normally.
 */
export function withUpdatedSince(
  input: Omit<GraphqlSoupInput, 'cursor'>,
  updatedSince: string | null
): Omit<GraphqlSoupInput, 'cursor'> {
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

export async function runSoupBackfill(
  userId: string,
  params: SoupBackfillParams,
  signal: AbortSignal
): Promise<SoupBackfillCheckpoint> {
  let checkpoint = loadSoupBackfillCheckpoint(userId, params.checkpointId);

  if (checkpoint.completed || checkpoint.scanStartedAt === null) {
    checkpoint = {
      ...checkpoint,
      nextCursor: checkpoint.completed ? null : checkpoint.nextCursor,
      completed: false,
      scanStartedAt: new Date().toISOString(),
    };
    saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);
  }

  const passInput = withUpdatedSince(params.input, checkpoint.updatedSince);

  while (!signal.aborted) {
    const page = await fetchGraphqlSoup(
      {
        ...passInput,
        cursor: checkpoint.nextCursor ?? undefined,
      },
      {
        signal,
        // Backfill must stop on a network failure instead of advancing from
        // an old offline page. TanStack retries from the persisted cursor.
        allowOfflineFallback: false,
      }
    );

    const completed = page.next_cursor == null;
    checkpoint = {
      ...checkpoint,
      nextCursor: page.next_cursor ?? null,
      pagesFetched: checkpoint.pagesFetched + 1,
      itemsFetched: checkpoint.itemsFetched + page.items.length,
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
    saveSoupBackfillCheckpoint(checkpoint, params.checkpointId);

    if (checkpoint.completed) return checkpoint;

    await delay(params.pageDelayMs ?? PAGE_DELAY_MS, signal);
  }

  throw abortReason(signal);
}

/**
 * Slowly fills the browser GraphQL cache with every expanded Soup page.
 * The next cursor is persisted after each successful page so retries and
 * future sessions resume from the first unfinished page.
 */
export function useSoupBackfill(
  userId: Accessor<string | undefined>,
  params?: Accessor<SoupBackfillParams>
) {
  return useQuery(() => {
    const currentUserId = userId();
    const currentParams = params?.() ?? ALL_SOUP_BACKFILL_PARAMS;

    return {
      queryKey: [
        'graphql-soup-backfill',
        BACKFILL_VERSION,
        currentUserId,
        currentParams.checkpointId,
      ] as const,
      enabled: currentUserId !== undefined && graphqlCacheEnabled(),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        return runSoupBackfill(currentUserId!, currentParams, signal);
      },
      networkMode: 'online' as const,
      retry: 5,
      retryDelay: backfillRetryDelay,
      // A later mount starts another pass using the persisted updatedSince.
      staleTime: 0,
      refetchOnWindowFocus: false,
    };
  });
}

/** Backfills only email threads using an independent persisted checkpoint. */
export function useEmailSoupBackfill(userId: Accessor<string | undefined>) {
  return useSoupBackfill(userId, () => EMAIL_SOUP_BACKFILL_PARAMS);
}
