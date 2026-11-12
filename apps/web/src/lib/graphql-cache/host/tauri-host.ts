import type { MutationInspection } from '../protocol';

/**
 * Tauri CacheHost: talks to the native cache engine living in the Tauri
 * host process (graphql_cache_plugin) over invoke commands. The host
 * process is the single shared engine instance across all webviews/windows
 * (SharedWorker semantics); change pushes arrive as a broadcast tauri event
 * that every webview filters by its own clientId prefix — mirroring
 * worker-host.ts.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AffectedOperationsResult,
  CacheChangeHints,
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CacheRevision,
  CalendarCommitArgs,
  CalendarCommitCacheResult,
  CalendarRangeCacheArgs,
  CalendarRangeCacheResult,
  ClaimedMutation,
  CommitOptimisticWriteResult,
  DeferOptimisticWriteResult,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
  HydrationResult,
  LiveQueryUpdate,
  MutationClaim,
  MutationSettlement,
  ReadRecordsByKeysArgs,
  ReadRecordsByKeysResult,
  ReadResult,
  RecordFieldChange,
  RollbackOptimisticWriteResult,
  SearchCacheArgs,
  SearchCachePage,
  WriteResult,
} from '../protocol';
import {
  isRecordFieldChanges,
  parseCacheRevision,
  parseStorageGeneration,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
} from '../protocol';
import type {
  AffectedOperationsListener,
  CacheChangeListener,
  CacheChangeOptions,
  CacheGenerationChange,
  CacheHost,
  CacheHydrateArgs,
  CacheReadArgs,
  CacheWriteArgs,
  EnqueueOptimisticMutationArgs,
  InitialMutationClaimArgs,
  InspectQueryArgs,
  InspectQueryVariantsArgs,
} from './types';

/** Keep in sync with `OPS_AFFECTED_EVENT` in graphql_cache_plugin. */
const OPS_AFFECTED_EVENT = 'graphql-cache://ops-affected';
/** Keep in sync with `CACHE_CHANGED_EVENT` in the native plugin. */
const CACHE_CHANGED_EVENT = 'graphql-cache://cache-changed';
// Published by the JS host after hydration, including on older native binaries.
const CACHE_HYDRATED_EVENT = 'graphql-cache://cache-hydrated';
/** Keep in sync with `MUTATION_SETTLED_EVENT` in graphql_cache_plugin. */
const MUTATION_SETTLED_EVENT = 'graphql-cache://mutation-settled';

/** Payload of the ops-affected event (graphql_cache_plugin `OpsAffectedEvent`). */
type OpsAffectedPayload = {
  fieldChanges?: RecordFieldChange[];
  opIds: string[];
};

type CacheChangedPayload = {
  revision: string;
  reset?: boolean;
} & CacheChangeHints;

// Older native binaries omit the advancement bit and still receive OTA JS.
import { createPeopleCache } from '../people/host';
import { PEOPLE_UNSUPPORTED } from '../people/protocol';

type NativeHydrationResult = HydrationResult & { revisionAdvanced?: boolean };
const PEOPLE_CONTEXT_COMMAND = 'graphql_cache_people_context';
const PEOPLE_SEARCH_COMMAND = 'graphql_cache_people_search';
const PEOPLE_REFERENCES_COMMAND = 'graphql_cache_people_resolve_references';
const PEOPLE_SQL_COMMAND = 'graphql_cache_people_read_sql';
const PEOPLE_UPDATE_COMMAND = 'graphql_cache_people_update';

export interface TauriHostOptions {
  scope: string;
  hotCapacity?: number;
  /**
   * Read and initialization timeout in ms (default 10s, matching worker-host).
   * Other commands keep running natively after a caller stops waiting, so they
   * wait for the engine's outcome instead of reporting a failure that may
   * already have committed.
   */
  requestTimeoutMs?: number;
  /** Reports an asynchronous durable-storage initialization failure. */
  onInitializationError?: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ENTITY_FILTER_COMMAND = 'graphql_cache_entity_filter';
const ENTITY_FILTER_RESUME_COMMAND = 'graphql_cache_entity_filter_resume';
// Match the engine view bound. Retention is only a request-size optimization.
const LIVE_QUERY_CAPACITY = 256;
const WATCH_COMMAND = 'graphql_cache_watch';
const CALENDAR_RANGE_COMMAND = 'graphql_cache_calendar_range';
const CALENDAR_COMMIT_COMMAND = 'graphql_cache_calendar_commit';
const INSPECT_MUTATIONS_COMMAND = 'graphql_cache_inspect_mutations';

const INIT_COMMAND = 'graphql_cache_init_with_schema';

// The only commands a caller stops waiting for: a read falls back to the
// network, and a hung init would block every request. Tauri cannot cancel a
// command, so any other command still commits after its caller gives up.
const TIMED_COMMANDS: ReadonlySet<string> = new Set([
  INIT_COMMAND,
  INSPECT_MUTATIONS_COMMAND,
  'graphql_cache_current_revision',
  'graphql_cache_current_storage_generation',
  'graphql_cache_read',
  WATCH_COMMAND,
  'graphql_cache_read_records_by_keys',
  'graphql_cache_search',
  ENTITY_FILTER_COMMAND,
  ENTITY_FILTER_RESUME_COMMAND,
  CALENDAR_RANGE_COMMAND,
  PEOPLE_CONTEXT_COMMAND,
  PEOPLE_SEARCH_COMMAND,
  'graphql_cache_inspect_query_variants',
  'graphql_cache_inspect_query',
]);

// A deadline timer running this late measured a stall of the page itself (an
// occluded or napping window, a long task): the engine's answer may already be
// queued behind it. Time out only after a window the page ran through on time.
const PAGE_STALL_MS = 1_000;

const DRAFTS_NEED_UPDATE =
  'Update Macro to sync drafts saved on this device. Your queued drafts are preserved until the app is updated.';
const CACHE_NEEDS_UPDATE =
  'Update Macro to use the local cache on this device. Until the app is updated, drafts saved here do not sync, and queued drafts are preserved.';

/**
 * The installed native app is older than this OTA bundle and lacks a cache
 * command it needs. OTA updates cannot add Rust commands, so only an app
 * update helps; the bundle runs uncached until then.
 */
export class NativeCacheUpgradeRequiredError extends Error {
  constructor(message: string = DRAFTS_NEED_UPDATE) {
    super(message);
    this.name = 'NativeCacheUpgradeRequiredError';
  }
}

export function createTauriCacheHost(options: TauriHostOptions): CacheHost {
  const clientId = crypto.randomUUID();
  const affectedSubscribers = new Set<AffectedOperationsListener>();
  const cacheChangeSubscribers = new Set<CacheChangeListener>();
  const hydrationSubscribers = new Set<CacheChangeListener>();
  const generationChangeSubscribers = new Set<
    (change: CacheGenerationChange) => void
  >();
  const settlementSubscribers = new Set<
    (settlement: MutationSettlement) => void
  >();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // TODO(native-full-release): Remove this flag and the missing-command fallback
  // once a full native/iOS release includes entity filtering AND older binaries
  // no longer receive these OTA bundles. OTA updates cannot add Rust commands.
  // Keep this per host so a new native binary is probed again after restarting.
  let entityFilterUnavailable = false;
  // Binaries before incremental watches still serve full reads.
  let watchUnavailable = false;
  let peopleUnavailable = false;
  let peopleSqlUnavailable = false;
  let contactSyncUnavailable = false;
  let referencesUnavailable = false;
  let scopedHydrationSupported: Promise<boolean> | undefined;
  // Native binaries before the calendar range index answer `unsupported`, so
  // the calendar keeps reading from the network until the app updates.
  let calendarUnavailable = false;
  const isMissingCommand = (error: unknown, command: string): boolean =>
    error instanceof Error && error.message === `Command ${command} not found`;

  // Revisions are monotonic for the native engine's lifetime. This also gates
  // repeated no-op hydrations on older binaries without revisionAdvanced.
  let latestObservedRevision = 0n;
  function observeRevision(revision: CacheRevision): boolean {
    const next = BigInt(revision);
    if (next <= latestObservedRevision) return false;
    latestObservedRevision = next;
    return true;
  }

  // Only identical in-flight reads share a result. Any intervening command or
  // native notification is a barrier: never reuse a read across a write/reset.
  const pendingReads = new Map<string, Promise<ReadResult>>();
  const liveQueries = new Map<
    string,
    { descriptor: string; registrationId?: string }
  >();

  const pendingAffected = new Set<number>();
  let affectedTimer: ReturnType<typeof setTimeout> | undefined;

  function flushAffected() {
    clearTimeout(affectedTimer);
    affectedTimer = undefined;
    if (!pendingAffected.size) return;
    const keys = [...pendingAffected];
    pendingAffected.clear();
    for (const cb of affectedSubscribers) cb(keys);
  }

  async function request<T>(
    command: string,
    args: Record<string, unknown>
  ): Promise<T> {
    if (command !== 'graphql_cache_read') pendingReads.clear();
    const span = Telemetry.span('graphql_cache.ipc.request', {
      sampling: 'perf',
    });
    span.setAttr('graphql_cache.ipc.command', command);
    const traceparent = span.traceparent();
    const wireArgs = traceparent ? { ...args, traceparent } : args;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let pageStallMs = 0;
    try {
      const operation = span.run(() => invoke<T>(command, wireArgs));
      const deadline = TIMED_COMMANDS.has(command)
        ? new Promise<never>((_, reject) => {
            const arm = () => {
              const due = performance.now() + requestTimeoutMs;
              timer = setTimeout(() => {
                const late = performance.now() - due;
                if (late > PAGE_STALL_MS) {
                  pageStallMs += late;
                  arm();
                  return;
                }
                timedOut = true;
                reject(new Error(`graphql cache ipc timeout: ${command}`));
              }, requestTimeoutMs);
            };
            arm();
          })
        : undefined;
      const value = await (deadline
        ? Promise.race([operation, deadline])
        : operation);
      span.setAttr('graphql_cache.ipc.outcome', 'ok');
      return value;
    } catch (error) {
      span.setAttr('graphql_cache.ipc.outcome', timedOut ? 'timeout' : 'error');
      span.error(
        timedOut
          ? 'Native cache request timed out'
          : 'Native cache request failed'
      );
      // Native command errors cross the boundary as strings.
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
      if (pageStallMs > 0)
        span.setAttr(
          'graphql_cache.ipc.page_stall_ms',
          Math.round(pageStallMs)
        );
      span.end();
    }
  }

  // Failure tolerated: reads/writes still work, only push-driven
  // re-execution is lost — same degradation as a broken worker port.
  const unlistenOps: Promise<UnlistenFn | undefined> =
    listen<OpsAffectedPayload>(OPS_AFFECTED_EVENT, (event) => {
      pendingReads.clear();

      const prefix = `${clientId}:`;
      const opKeys = event.payload.opIds
        .filter((id) => id.startsWith(prefix))
        .map((id) => Number(id.slice(prefix.length)))
        .filter((n) => Number.isFinite(n));
      if (opKeys.length === 0) return;
      if (isRecordFieldChanges(event.payload.fieldChanges)) {
        // Patches are ordered data, so deliver them immediately after earlier
        // invalidations. Only conservative reread notifications can coalesce.
        flushAffected();
        for (const cb of affectedSubscribers)
          cb(opKeys, event.payload.fieldChanges);
      } else {
        for (const key of opKeys) pendingAffected.add(key);
        affectedTimer ??= setTimeout(flushAffected, 0);
      }
    }).catch((error) => {
      console.warn('graphql cache ops-affected listener failed', error);
      return undefined;
    });
  const unlistenSettlements: Promise<UnlistenFn | undefined> =
    listen<MutationSettlement>(MUTATION_SETTLED_EVENT, (event) => {
      pendingReads.clear();
      flushAffected();
      for (const cb of settlementSubscribers) cb(event.payload);
    }).catch((error) => {
      console.warn('graphql cache mutation-settled listener failed', error);
      return undefined;
    });

  const unlistenCacheChanges: Promise<UnlistenFn | undefined> =
    listen<CacheChangedPayload>(CACHE_CHANGED_EVENT, (event) => {
      pendingReads.clear();
      flushAffected();
      const revision = parseCacheRevision(event.payload.revision);
      observeRevision(revision);
      if (event.payload.reset) {
        liveQueries.clear();
        for (const cb of generationChangeSubscribers) cb({ storage: 'reset' });
      }
      for (const cb of cacheChangeSubscribers) {
        if (
          event.payload.reset ||
          (event.payload.searchChangedBuckets === undefined &&
            event.payload.unchangedViews === undefined)
        )
          cb(revision);
        else
          cb(revision, {
            searchChangedBuckets: event.payload.searchChangedBuckets,
            unchangedViews: event.payload.unchangedViews,
          });
      }
    }).catch((error) => {
      console.warn('graphql cache change listener failed', error);
      return undefined;
    });

  async function listenForHydration(): Promise<UnlistenFn | undefined> {
    try {
      return await listen<CacheChangedPayload>(
        CACHE_HYDRATED_EVENT,
        (event) => {
          pendingReads.clear();
          flushAffected();
          const revision = parseCacheRevision(event.payload.revision);
          observeRevision(revision);
          for (const cb of hydrationSubscribers) {
            cb(revision, {
              searchChangedBuckets: event.payload.searchChangedBuckets,
              unchangedViews: event.payload.unchangedViews,
            });
          }
        }
      );
    } catch (error) {
      console.warn('graphql cache hydration listener failed', error);
      return undefined;
    }
  }
  const unlistenHydration = listenForHydration();

  async function initialize(): Promise<void> {
    const { default: schemaSdl } = await import(
      '../../../../../../static_assets/schema.graphql?raw'
    );
    // An app from before runtime SDL loading has no such command. Its own
    // `graphql_cache_init` would run its compiled-in schema, which can lack
    // fields this bundle reads, so the bundle stays uncached instead.
    try {
      await request<void>(INIT_COMMAND, {
        scope: options.scope,
        hotCapacity: options.hotCapacity,
        schemaSdl,
      });
    } catch (error) {
      if (isMissingCommand(error, INIT_COMMAND)) {
        throw new NativeCacheUpgradeRequiredError(CACHE_NEEDS_UPDATE);
      }
      throw error;
    }
    // Probe before any enqueue/claim. Older binaries silently ignore new
    // metadata arguments, so waiting until a draft fails would lose correlation.
    try {
      await request<MutationInspection[]>(INSPECT_MUTATIONS_COMMAND, {});
    } catch (error) {
      if (isMissingCommand(error, INSPECT_MUTATIONS_COMMAND)) {
        throw new NativeCacheUpgradeRequiredError();
      }
      throw error;
    }
  }
  const ready = initialize();
  fireAndForget(
    (async () => {
      try {
        await ready;
      } catch (error) {
        options.onInitializationError?.(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })(),
    'graphql-cache-host'
  );

  async function publishHydration(
    revision: CacheRevision,
    advanced: boolean | undefined,
    searchChangedBuckets: string[] | undefined,
    unchangedViews?: string[]
  ): Promise<void> {
    const newlyObserved = observeRevision(parseCacheRevision(revision));
    if (advanced === false || !newlyObserved) return;
    try {
      await emit(CACHE_HYDRATED_EVENT, {
        revision,
        ...(unchangedViews !== undefined ? { unchangedViews } : {}),
        ...(searchChangedBuckets !== undefined ? { searchChangedBuckets } : {}),
      });
    } catch (error) {
      // Notification failure must not turn a committed write into a retry.
      console.warn('graphql cache hydration notification failed', error);
    }
  }

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,
    liveQueries: true,
    people: createPeopleCache({
      async snapshot(args, traceparent) {
        await ready;
        if (contactSyncUnavailable) return { kind: 'unsupported' };
        try {
          return await request('graphql_cache_contact_snapshot', {
            request: args,
            traceparent,
          });
        } catch (error) {
          if (!isMissingCommand(error, 'graphql_cache_contact_snapshot'))
            throw error;
          contactSyncUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async reconcile(args, traceparent) {
        await ready;
        if (contactSyncUnavailable) return { kind: 'unsupported' };
        try {
          const result = await request<WriteResult>(
            'graphql_cache_contact_reconcile',
            { request: args, traceparent }
          );
          return result.revision;
        } catch (error) {
          if (!isMissingCommand(error, 'graphql_cache_contact_reconcile'))
            throw error;
          contactSyncUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async readSql(args, traceparent) {
        await ready;
        if (peopleSqlUnavailable) return { kind: 'unsupported' };
        try {
          return await request(PEOPLE_SQL_COMMAND, {
            request: args,
            traceparent,
          });
        } catch (error) {
          if (!isMissingCommand(error, PEOPLE_SQL_COMMAND)) throw error;
          peopleSqlUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async resolveReferences(args, traceparent) {
        await ready;
        if (referencesUnavailable) return { kind: 'unsupported' };
        try {
          return await request(PEOPLE_REFERENCES_COMMAND, {
            request: args,
            traceparent,
          });
        } catch (error) {
          if (!isMissingCommand(error, PEOPLE_REFERENCES_COMMAND)) throw error;
          referencesUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async context(scope, traceparent) {
        await ready;
        if (peopleUnavailable) return { kind: 'unsupported' };
        try {
          return await request(PEOPLE_CONTEXT_COMMAND, { scope, traceparent });
        } catch (error) {
          if (!isMissingCommand(error, PEOPLE_CONTEXT_COMMAND)) throw error;
          peopleUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async search(args, traceparent) {
        await ready;
        if (peopleUnavailable) return { kind: 'unsupported' };
        try {
          return await request(PEOPLE_SEARCH_COMMAND, {
            request: args,
            traceparent,
          });
        } catch (error) {
          if (!isMissingCommand(error, PEOPLE_SEARCH_COMMAND)) throw error;
          peopleUnavailable = true;
          return { kind: 'unsupported' };
        }
      },
      async update(update, traceparent) {
        await ready;
        if (peopleUnavailable) throw new Error(PEOPLE_UNSUPPORTED);
        let result: WriteResult;
        try {
          result = await request<WriteResult>(PEOPLE_UPDATE_COMMAND, {
            update,
            traceparent,
          });
        } catch (error) {
          if (!isMissingCommand(error, PEOPLE_UPDATE_COMMAND)) throw error;
          peopleUnavailable = true;
          throw new Error(PEOPLE_UNSUPPORTED);
        }
        await publishHydration(result.revision, result.revisionAdvanced, [
          'person',
        ]);
        return result.revision;
      },
    }),

    async currentRevision(): Promise<CacheRevision> {
      await ready;
      return parseCacheRevision(
        await request<string>('graphql_cache_current_revision', {})
      );
    },

    async currentStorageGeneration(): Promise<string> {
      await ready;
      return parseStorageGeneration(
        await request<string>('graphql_cache_current_storage_generation', {})
      );
    },

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      await ready;
      const wireArgs = {
        opId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        entityResolvers: args.entityResolvers,
      };
      const key = JSON.stringify(wireArgs);
      const pending = pendingReads.get(key);
      if (pending) return pending;
      const reading = request<ReadResult>('graphql_cache_read', wireArgs);
      pendingReads.set(key, reading);
      try {
        return await reading;
      } finally {
        if (pendingReads.get(key) === reading) pendingReads.delete(key);
      }
    },

    async watchQuery(args) {
      await ready;
      if (watchUnavailable) return { kind: 'unsupported' };
      try {
        return await request(WATCH_COMMAND, {
          opId: opId(args.opKey),
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          entityResolvers: args.entityResolvers,
          since: args.since,
        });
      } catch (error) {
        if (!isMissingCommand(error, WATCH_COMMAND)) throw error;
        watchUnavailable = true;
        return { kind: 'unsupported' };
      }
    },

    async readRecordsByKeys(
      args: ReadRecordsByKeysArgs
    ): Promise<ReadRecordsByKeysResult> {
      const keys = validateRecordSelectionKeys(args.keys);
      await ready;
      if (keys.length === 0) {
        // Preserve a fresh revision fence without sending an unused fragment.
        const revision = parseCacheRevision(
          await request<string>('graphql_cache_current_revision', {})
        );
        return { revision, records: [] };
      }
      const result = await request<ReadRecordsByKeysResult>(
        'graphql_cache_read_records_by_keys',
        {
          document: args.document,
          fragmentName: args.fragmentName,
          keys,
        }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async search(args: SearchCacheArgs): Promise<SearchCachePage> {
      const searchRequest = validateCacheSearchArgs(args);
      await ready;
      return await request<SearchCachePage>('graphql_cache_search', {
        request: searchRequest,
      });
    },

    async entityFilter(
      args: EntityFilterCacheArgs
    ): Promise<EntityFilterCacheResult> {
      await ready;
      if (entityFilterUnavailable) return { kind: 'unsupported' };
      try {
        const live = args.liveQuery;
        if (live?.release) liveQueries.delete(live.id);
        let registration:
          | { descriptor: string; registrationId?: string }
          | undefined;
        if (live && !live.release) {
          const descriptor = JSON.stringify({
            ...args,
            liveQuery: { ...live, since: undefined },
          });
          registration = liveQueries.get(live.id);
          if (registration?.descriptor !== descriptor)
            registration = { descriptor };
          liveQueries.delete(live.id);
          liveQueries.set(live.id, registration);
          if (liveQueries.size > LIVE_QUERY_CAPACITY) {
            const oldest = liveQueries.keys().next().value;
            if (oldest !== undefined) liveQueries.delete(oldest);
          }
          if (registration.registrationId) {
            const update = await request<LiveQueryUpdate | null>(
              ENTITY_FILTER_RESUME_COMMAND,
              {
                id: live.id,
                registrationId: registration.registrationId,
                since: live.since,
              }
            );
            if (update !== null) return update;
          }
        }
        const result = await request<EntityFilterCacheResult>(
          ENTITY_FILTER_COMMAND,
          {
            request: args,
          }
        );
        // A source change, release, reset or disposal may have happened in flight.
        if (
          live &&
          registration &&
          liveQueries.get(live.id) === registration &&
          result.kind === 'live-query'
        ) {
          registration.registrationId = result.registrationId;
        }
        return result;
      } catch (error) {
        // Match Tauri's exact unknown-command response, not storage, validation,
        // ACL or timeout failures. Preserve the pre-OTA behavior on old binaries.
        if (
          !(error instanceof Error) ||
          error.message !== `Command ${ENTITY_FILTER_COMMAND} not found`
        ) {
          throw error;
        }
        entityFilterUnavailable = true;
        return { kind: 'unsupported' };
      }
    },

    async calendarRange(
      args: CalendarRangeCacheArgs
    ): Promise<CalendarRangeCacheResult> {
      await ready;
      if (calendarUnavailable) return { kind: 'unsupported' };
      try {
        const result = await request<CalendarRangeCacheResult>(
          CALENDAR_RANGE_COMMAND,
          { request: args }
        );
        return result.kind === 'unsupported'
          ? result
          : { ...result, revision: parseCacheRevision(result.revision) };
      } catch (error) {
        if (!isMissingCommand(error, CALENDAR_RANGE_COMMAND)) throw error;
        calendarUnavailable = true;
        return { kind: 'unsupported' };
      }
    },

    async calendarCommit(
      args: CalendarCommitArgs
    ): Promise<CalendarCommitCacheResult> {
      await ready;
      if (calendarUnavailable) return { kind: 'unsupported' };
      try {
        const result = await request<WriteResult>(CALENDAR_COMMIT_COMMAND, {
          commit: args,
        });
        return {
          kind: 'committed',
          revision: parseCacheRevision(result.revision),
          changed: result.changed,
        };
      } catch (error) {
        if (!isMissingCommand(error, CALENDAR_COMMIT_COMMAND)) throw error;
        calendarUnavailable = true;
        return { kind: 'unsupported' };
      }
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>('graphql_cache_write', {
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        registration:
          args.registerDependencies && args.opKey !== undefined
            ? {
                opId: opId(args.opKey),
                entityResolvers: args.entityResolvers,
              }
            : undefined,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      });
    },

    async hydrateQuery(args: CacheHydrateArgs): Promise<HydrationResult> {
      await ready;
      if (args.hydrationScope) {
        scopedHydrationSupported ??= request<SearchCachePage>(
          'graphql_cache_search',
          {
            request: {
              profile: 'quick-access-v1',
              buckets: ['person'],
              query: '',
              limit: 1,
              nowMs: 0,
            },
          }
        )
          .then((page) => (page.projectionVersion ?? 0) >= 5)
          .catch((error: unknown) => {
            scopedHydrationSupported = undefined;
            throw error;
          });
        if (!(await scopedHydrationSupported))
          throw new Error('Scoped cache hydration is unsupported');
      }
      const payload = {
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      };
      const result = args.hydrationScope
        ? await request<NativeHydrationResult>('graphql_cache_hydrate_scoped', {
            request: { ...payload, hydrationScope: args.hydrationScope },
          })
        : await request<NativeHydrationResult>(
            'graphql_cache_hydrate',
            payload
          );
      await publishHydration(
        result.revision,
        result.revisionAdvanced,
        result.searchChangedBuckets,
        result.unchangedViews
      );
      return result;
    },

    async enqueueOptimisticMutation(
      args: EnqueueOptimisticMutationArgs,
      claim: InitialMutationClaimArgs
    ): Promise<EnqueueOptimisticMutationResult> {
      await ready;
      return await request<EnqueueOptimisticMutationResult>(
        'graphql_cache_enqueue_optimistic_mutation',
        {
          originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
          uuid: args.uuid,
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
          linkPatches: args.linkPatches,
          revalidations: args.revalidations,
          identityBindings: args.identityBindings,
          clientMetadata: args.clientMetadata,
          uncertainCalendarEventKeys: args.uncertainCalendarEventKeys,
          createdAtMs: claim.nowMs,
          owner: claim.owner,
          nowMs: claim.nowMs,
          leaseExpiresAtMs: claim.leaseExpiresAtMs,
        }
      );
    },

    async inspectQueryVariants(
      args: InspectQueryVariantsArgs
    ): Promise<CachedQueryVariantWire[]> {
      await ready;
      return await request<CachedQueryVariantWire[]>(
        'graphql_cache_inspect_query_variants',
        {
          query: args.query,
          operationName: args.operationName,
          path: args.path,
        }
      );
    },

    async inspectQuery(
      args: InspectQueryArgs
    ): Promise<CachedQueryInstanceWire[]> {
      await ready;
      return await request<CachedQueryInstanceWire[]>(
        'graphql_cache_inspect_query',
        {
          query: args.query,
          operationName: args.operationName,
          path: args.path,
          variableFilters: args.variableFilters,
        }
      );
    },

    async inspectMutations() {
      await ready;
      return await request<MutationInspection[]>(INSPECT_MUTATIONS_COMMAND, {});
    },
    async claimNextMutation(
      owner: string,
      nowMs: number,
      leaseExpiresAtMs: number
    ): Promise<ClaimedMutation | undefined> {
      await ready;
      return await request<ClaimedMutation | undefined>(
        'graphql_cache_claim_next_mutation',
        { owner, nowMs, leaseExpiresAtMs }
      );
    },

    async deferOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      nextAttemptAtMs: number,
      error: string,
      serverFailure = false
    ): Promise<DeferOptimisticWriteResult> {
      await ready;
      return await request<DeferOptimisticWriteResult>(
        'graphql_cache_defer_optimistic_write',
        {
          transactionId,
          leaseOwner: claim.owner,
          leaseGeneration: claim.generation,
          nextAttemptAtMs,
          error,
          serverFailure,
        }
      );
    },

    async commitOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      args: CacheWriteArgs
    ): Promise<CommitOptimisticWriteResult> {
      await ready;
      return await request<CommitOptimisticWriteResult>(
        'graphql_cache_commit_optimistic_write',
        {
          transactionId,
          leaseOwner: claim.owner,
          leaseGeneration: claim.generation,
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
        }
      );
    },

    async rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string,
      errorCode?: string
    ): Promise<RollbackOptimisticWriteResult> {
      await ready;
      return await request<RollbackOptimisticWriteResult>(
        'graphql_cache_rollback_optimistic_write',
        {
          transactionId,
          leaseOwner: claim.owner,
          leaseGeneration: claim.generation,
          error,
          ...(errorCode === undefined ? {} : { errorCode }),
        }
      );
    },

    async invalidate(keys: string[]): Promise<AffectedOperationsResult> {
      await ready;
      const result = await request<AffectedOperationsResult>(
        'graphql_cache_invalidate',
        { keys }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async deleteRecords(keys: string[]): Promise<AffectedOperationsResult> {
      await ready;
      const result = await request<AffectedOperationsResult>(
        'graphql_cache_delete_records',
        { keys }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async teardown(opKey: number): Promise<void> {
      await ready;
      await request('graphql_cache_teardown', { opId: opId(opKey) });
    },

    async clear(): Promise<CacheRevision> {
      await ready;
      return parseCacheRevision(
        await request<string>('graphql_cache_clear', {})
      );
    },

    onOpsAffected(cb: AffectedOperationsListener): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    onCacheChanged(
      cb: CacheChangeListener,
      options?: CacheChangeOptions
    ): () => void {
      cacheChangeSubscribers.add(cb);
      if (options?.includeHydration) hydrationSubscribers.add(cb);
      return () => {
        cacheChangeSubscribers.delete(cb);
        hydrationSubscribers.delete(cb);
      };
    },

    onCacheGenerationChanged(
      cb: (change: CacheGenerationChange) => void
    ): () => void {
      generationChangeSubscribers.add(cb);
      return () => generationChangeSubscribers.delete(cb);
    },

    onMutationSettled(
      cb: (settlement: MutationSettlement) => void
    ): () => void {
      settlementSubscribers.add(cb);
      return () => settlementSubscribers.delete(cb);
    },

    dispose() {
      clearTimeout(affectedTimer);
      pendingAffected.clear();
      pendingReads.clear();
      liveQueries.clear();
      affectedSubscribers.clear();
      cacheChangeSubscribers.clear();
      hydrationSubscribers.clear();
      generationChangeSubscribers.clear();
      settlementSubscribers.clear();
      for (const unlisten of [
        unlistenOps,
        unlistenCacheChanges,
        unlistenHydration,
        unlistenSettlements,
      ]) {
        // UnlistenFn returns the unlisten IPC promise despite its void type.
        fireAndForget(
          unlisten.then((fn) => fn?.()),
          'graphql-cache-host'
        );
      }
    },
  };
}
