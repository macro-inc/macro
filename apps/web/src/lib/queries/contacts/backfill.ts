import type { CacheHost } from '@graphql-cache/host/types';
import { captureContactWriteScope } from '@graphql-cache/people/sync';
import { CONTACT_SYNC_UNSUPPORTED } from '@graphql-cache/people/sync-protocol';
import {
  isStaleHydrationScopeError,
  isStorageGeneration,
} from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import { hydrateGraphqlContacts } from '@service-storage/graphql-contacts';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';
import { type Accessor, createEffect, onCleanup, untrack } from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { ContactDirectoryScopeError } from './cache-scope';
import { reconcileContactPage } from './reconcile';
import { contactRefreshRevision } from './refresh';

const CHECKPOINT_VERSION = 2;
const REFRESH_INTERVAL_MS = 15 * 60_000;
const NAME_REFRESH_MS = 60 * 60_000;
const PAGE_DELAY_MS = 250;

export type ContactCheckpoint = {
  userId: string;
  storageGeneration: string;
  nextCursor: string | null;
  pages: number;
  phase: 'hydrate' | 'verify';
  verificationIncomplete: boolean;
  completedAt: number | null;
};

export type ContactSyncProgress =
  | { kind: 'unsupported' }
  | { kind: 'cold' | 'partial' | 'complete'; checkpoint: ContactCheckpoint };

type BackfillHost = Pick<
  CacheHost,
  'currentStorageGeneration' | 'search' | 'hydrateQuery' | 'disabled' | 'people'
>;

const checkpointKey = (userId: string) =>
  `graphql-contacts-backfill:v${CHECKPOINT_VERSION}:${userId}`;

function isCheckpoint(value: unknown): value is ContactCheckpoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'storageGeneration' in value &&
    isStorageGeneration(value.storageGeneration) &&
    'nextCursor' in value &&
    (value.nextCursor === null ||
      (typeof value.nextCursor === 'string' &&
        value.nextCursor.length <= 1024 &&
        !value.nextCursor.includes('\0'))) &&
    'phase' in value &&
    (value.phase === 'hydrate' || value.phase === 'verify') &&
    'verificationIncomplete' in value &&
    typeof value.verificationIncomplete === 'boolean' &&
    'pages' in value &&
    typeof value.pages === 'number' &&
    Number.isSafeInteger(value.pages) &&
    value.pages >= 0 &&
    'completedAt' in value &&
    (value.completedAt === null ||
      (typeof value.completedAt === 'number' &&
        Number.isFinite(value.completedAt) &&
        value.completedAt > 0 &&
        value.pages > 0 &&
        value.nextCursor === null &&
        value.phase === 'verify' &&
        !value.verificationIncomplete))
  );
}

/** Checkpoints prove only a completed snapshot in the same durable generation. */
export function loadContactCheckpoint(
  userId: string,
  storageGeneration: string
): ContactCheckpoint {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(checkpointKey(userId)) ?? 'null'
    );
    if (
      isCheckpoint(value) &&
      value.userId === userId &&
      value.storageGeneration === storageGeneration
    )
      return value;
  } catch {
    /* Missing storage only causes an idempotent replay. */
  }
  return {
    userId,
    storageGeneration,
    nextCursor: null,
    pages: 0,
    phase: 'hydrate',
    verificationIncomplete: false,
    completedAt: null,
  };
}

const completionListeners = new Set<(checkpoint: ContactCheckpoint) => void>();

/** Completion follows the durable page acknowledgement, not its earlier cache hint. */
export function subscribeContactCheckpoint(
  userId: string,
  listener: (checkpoint: ContactCheckpoint) => void
): () => void {
  const receive = (checkpoint: ContactCheckpoint) => {
    if (checkpoint.userId === userId && checkpoint.completedAt !== null)
      listener(checkpoint);
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== checkpointKey(userId) || !event.newValue) return;
    try {
      const value: unknown = JSON.parse(event.newValue);
      if (isCheckpoint(value)) receive(value);
    } catch {
      /* Invalid external metadata is not completion evidence. */
    }
  };
  completionListeners.add(receive);
  window.addEventListener('storage', storageChanged);
  return () => {
    completionListeners.delete(receive);
    window.removeEventListener('storage', storageChanged);
  };
}

function saveCheckpoint(checkpoint: ContactCheckpoint): void {
  try {
    localStorage.setItem(
      checkpointKey(checkpoint.userId),
      JSON.stringify(checkpoint)
    );
    if (checkpoint.completedAt !== null) {
      for (const listener of completionListeners) {
        try {
          listener(checkpoint);
        } catch {
          /* A notification cannot undo a committed checkpoint. */
        }
      }
    }
  } catch {
    /* A failed checkpoint write must never skip unpersisted records. */
  }
}

/** One resumable scan, holding at most one network/cache page. Completed scans
 * refresh at most hourly, or on the caller's coalesced invalidation cadence. */
export const runContactBackfill = Effect.fn('runContactBackfill')(function* (
  userId: string,
  host: BackfillHost,
  options: {
    refresh?: boolean;
    pageDelayMs?: number;
    fetchPage?: typeof hydrateGraphqlContacts;
    reconcilePage?: typeof reconcileContactPage;
    onProgress?: (progress: ContactSyncProgress) => void;
  } = {}
) {
  const capability = yield* Effect.tryPromise(() =>
    host.search({ profile: 'quick-access-v1', buckets: ['person'], limit: 1 })
  );
  if (host.disabled || (capability.projectionVersion ?? 0) < 5) {
    const progress = { kind: 'unsupported' } satisfies ContactSyncProgress;
    options.onProgress?.(progress);
    return progress;
  }
  const generation = yield* Effect.tryPromise(() =>
    host.currentStorageGeneration()
  );
  const scope = { storageGeneration: generation, identity: userId };
  const supported = yield* Effect.tryPromise((signal) =>
    captureContactWriteScope(host, scope, signal)
  );
  if (!supported) return { kind: 'unsupported' } satisfies ContactSyncProgress;
  let checkpoint = loadContactCheckpoint(userId, generation);
  if (checkpoint.completedAt !== null) {
    const refreshAge = options.refresh ? REFRESH_INTERVAL_MS : NAME_REFRESH_MS;
    if (Date.now() - checkpoint.completedAt < refreshAge) {
      const progress = {
        kind: 'complete',
        checkpoint,
      } satisfies ContactSyncProgress;
      options.onProgress?.(progress);
      return progress;
    }
    checkpoint = {
      ...checkpoint,
      nextCursor: null,
      pages: 0,
      phase: 'hydrate',
      verificationIncomplete: false,
      completedAt: null,
    };
  }
  if (checkpoint.verificationIncomplete && checkpoint.nextCursor === null)
    checkpoint = {
      ...checkpoint,
      phase: 'hydrate',
      verificationIncomplete: false,
      pages: 0,
    };
  saveCheckpoint(checkpoint);
  options.onProgress?.({
    kind: checkpoint.pages ? 'partial' : 'cold',
    checkpoint,
  });
  const fetchPage = options.fetchPage ?? hydrateGraphqlContacts;
  while (checkpoint.phase === 'hydrate') {
    const page = yield* Effect.tryPromise((signal) =>
      fetchPage(host, scope, checkpoint.nextCursor, signal)
    );
    const currentGeneration = yield* Effect.tryPromise(() =>
      host.currentStorageGeneration()
    );
    if (currentGeneration !== generation || page.user.id !== userId) {
      return yield* Effect.fail(new Error('cache hydration scope changed'));
    }
    const cursor = page.user.contacts.nextCursor;
    if (cursor !== null && cursor === checkpoint.nextCursor)
      return yield* Effect.fail(new Error('Contact cursor did not advance'));
    checkpoint = {
      ...checkpoint,
      nextCursor: cursor,
      pages: checkpoint.pages + 1,
      phase: cursor === null ? 'verify' : 'hydrate',
      completedAt: null,
    };
    saveCheckpoint(checkpoint);
    const progress = {
      kind: 'partial',
      checkpoint,
    } satisfies ContactSyncProgress;
    options.onProgress?.(progress);
    const delay = options.pageDelayMs ?? PAGE_DELAY_MS;
    if (delay > 0 && cursor !== null) yield* Effect.sleep(delay);
  }
  const reconcile = options.reconcilePage ?? reconcileContactPage;
  while (true) {
    const page = yield* Effect.tryPromise((signal) =>
      reconcile(host, scope, checkpoint.nextCursor, signal)
    );
    if (
      (yield* Effect.tryPromise(() => host.currentStorageGeneration())) !==
      generation
    )
      return yield* Effect.fail(new Error('cache hydration scope changed'));
    if (page.nextCursor !== null && page.nextCursor === checkpoint.nextCursor)
      return yield* Effect.fail(
        new Error('Contact verification did not advance')
      );
    const incomplete = checkpoint.verificationIncomplete || page.incomplete;
    checkpoint = {
      ...checkpoint,
      nextCursor: page.nextCursor,
      verificationIncomplete: incomplete,
      completedAt: page.nextCursor === null && !incomplete ? Date.now() : null,
    };
    saveCheckpoint(checkpoint);
    const progress = {
      kind: checkpoint.completedAt === null ? 'partial' : 'complete',
      checkpoint,
    } satisfies ContactSyncProgress;
    options.onProgress?.(progress);
    if (page.nextCursor === null) return progress;
    const delay = options.pageDelayMs ?? PAGE_DELAY_MS;
    if (delay > 0) yield* Effect.sleep(delay);
  }
});

/** Shares Soup's authenticated tab leadership and host-generation lifecycle.
 * Events do not interrupt scans. One maintenance tick every 15 minutes coalesces
 * invalidations; hourly full passes refresh names even without graph events.
 * Hydration omissions never delete. A second bounded pass verifies exact cached
 * IDs, without retaining a previous/seen directory set. */
export function useContactBackfill(
  userId: Accessor<string | undefined>,
  host: Accessor<BackfillHost | undefined>,
  generation: Accessor<number>
): void {
  const account = useQueryAccount();
  createEffect(() => {
    const owner = account();
    const id = userId();
    const cache = host();
    generation();
    if (!owner || owner.userId !== id || !id || !cache || cache.disabled)
      return;
    let processedInvalidation = -1;
    const cycle = Effect.tryPromise((signal) =>
      Telemetry.span('contacts.backfill', async (span) => {
        const requested = untrack(contactRefreshRevision);
        const startedAt = Date.now();
        try {
          const result = await Effect.runPromise(
            runContactBackfill(id, cache, {
              refresh: requested !== processedInvalidation,
              onProgress: (progress) => {
                span.setAttr('contacts.sync_state', progress.kind);
                if (progress.kind !== 'unsupported')
                  span.setAttr('contacts.pages', progress.checkpoint.pages);
              },
            }).pipe(
              Effect.retry({
                times: 3,
                schedule: Schedule.exponential('1 second'),
                while: (error) => {
                  const cause = 'error' in error ? error.error : error;
                  return (
                    !isStaleHydrationScopeError(cause) &&
                    !(cause instanceof ContactDirectoryScopeError) &&
                    !(
                      cause instanceof Error &&
                      cause.message === CONTACT_SYNC_UNSUPPORTED
                    )
                  );
                },
              })
            ),
            { signal }
          );
          if (
            result.kind === 'complete' &&
            result.checkpoint.completedAt !== null &&
            result.checkpoint.completedAt >= startedAt
          )
            processedInvalidation = requested;
        } catch (error) {
          span.setAttr(
            'contacts.sync_state',
            signal.aborted ? 'interrupted' : 'failed'
          );
          if (!signal.aborted) span.error('Contact backfill failed');
          throw error;
        }
      })
    ).pipe(Effect.ignore);
    const fiber = Effect.runFork(
      cycle.pipe(Effect.repeat(Schedule.spaced(REFRESH_INTERVAL_MS)))
    );
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  });
}
