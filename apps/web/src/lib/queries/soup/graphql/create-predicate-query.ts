import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  batch,
  createMemo,
  createRenderEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import {
  bumpRowVersion,
  unwrapStoreProxy,
} from '../../../graphql-cache/exchange/live-query';
import type { RecordSelection } from '../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../graphql-cache/host/types';
import {
  type CacheRevision,
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  parseCacheRevision,
} from '../../../graphql-cache/protocol';
import { createHiddenDeferral } from '../../visible-refresh';
import { soupCacheTelemetry } from './cache-activity-telemetry';
import { ImmutableLiveRows } from './immutable-live-rows';

/** A declared source and generated fragment; no mutation-specific query updates. */
export type PredicateQueryRequest<T> = {
  source: Omit<EntityFilterCacheArgs, 'liveQuery' | 'mail'> & {
    baseline: NonNullable<EntityFilterCacheArgs['baseline']>;
  };
  select: RecordSelection<T>;
  /**
   * Rows the view shows instead of the selected record. A host that shapes
   * them (`liveQueryRows`) sends `name`'s row and marks the reply (`row`), and
   * `toRow` adopts it (`shaped`); otherwise it sends the selected record, which
   * `toRow` shapes.
   * Rows are then immutable values rather than a store.
   */
  row?: {
    name: NonNullable<EntityFilterCacheArgs['liveQuery']>['row'];
    toRow: (record: object, shaped: boolean) => T;
  };
};

export type LiveQueryRow<T> = {
  recordKey: string;
  record: T;
  identity?: { mutationUuid: string | null; pending: boolean };
};

export type LiveQuerySnapshot<T> = {
  revision: CacheRevision;
  keys: readonly string[];
  records: readonly LiveQueryRow<T>[];
  retainedKeys: readonly string[];
  optimistic: boolean;
  /** Baseline keys that this predicate snapshot was evaluated against. */
  baselineKeys?: ReadonlySet<string>;
};

type LiveQueryHost = Pick<
  CacheHost,
  | 'entityFilter'
  | 'onCacheChanged'
  | 'onCacheGenerationChanged'
  | 'liveQueryRows'
>;

export type PredicateQueryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'error';

// A busy or stale cache must release cache-first readers to network hydration.
const MAX_STALE_READS = 3;

// Notifications can arrive out of order (native writes and hydrations take
// separate paths), so a read is stale against the highest one seen.
function laterRevision(
  current: CacheRevision | undefined,
  next: CacheRevision
): CacheRevision {
  return current !== undefined && BigInt(current) > BigInt(next)
    ? current
    : next;
}

/**
 * Binds one cache-engine maintained view for `createSoupLiveQuery`. Owns
 * subscription, coalescing, generation recovery, and keyed Solid rows.
 *
 * Internal to the Soup query layer, not a general reactive query API: GraphQL
 * documents use `createLiveQuery`, and Soup lists use `createSoupLiveQuery`.
 */
export function createPredicateQuery<T extends object>(options: {
  host: Accessor<LiveQueryHost | undefined>;
  query: Accessor<PredicateQueryRequest<T> | undefined>;
}) {
  const [data, setData] = createSignal<LiveQuerySnapshot<T>>();
  const [status, setStatus] = createSignal<PredicateQueryStatus>('idle');
  const [error, setError] = createSignal<unknown>();
  let requestRefresh = () => {};
  // A caller may derive a new request object from a query snapshot even when
  // its actual membership evidence and selection have not changed.
  const query = createMemo(options.query, undefined, {
    equals: (previous, next) =>
      JSON.stringify(previous) === JSON.stringify(next),
  });

  createRenderEffect(
    on([query, options.host], ([request, host]) => {
      setData(undefined);
      setError(undefined);
      if (!request || !host) {
        setStatus('idle');
        requestRefresh = () => {};
        return;
      }
      const id = crypto.randomUUID();
      const baselineKeys: ReadonlySet<string> = new Set(
        request.source.baseline.map((entry) => entry.key)
      );
      // Shaped rows are immutable values; selected records stay in a store.
      const immutable = request.row
        ? new ImmutableLiveRows<T>(request.row.toRow)
        : undefined;
      // Whether the last applied reply was shaped by the host.
      let lastShaped: boolean | undefined;
      const [rows, setRows] = createStore<Record<string, LiveQueryRow<T>>>({});
      const touchRowVersion = (recordKey: string) => {
        const row = rows[recordKey];
        if (!row) return;
        bumpRowVersion(unwrapStoreProxy(row.record));
      };
      let keys: readonly string[] = [];
      let orderedRows: readonly LiveQueryRow<T>[] = [];
      let since: CacheRevision | undefined;
      let latest: CacheRevision | undefined;
      let observationId: string | undefined;
      let epoch = 0;
      let active = true;
      let running = false;
      let pending = false;
      // A cache change seen while a read is in flight. The reply covers it when
      // its revision is at or past the change's, so only an error asks again.
      let changedDuringRead = false;
      let unsupported = false;
      let runPromise: Promise<void> | undefined;
      const args = (release = false): EntityFilterCacheArgs => ({
        ...request.source,
        liveQuery: {
          id,
          ...request.select,
          since,
          ...(release ? { release } : {}),
          ...(request.row?.name !== undefined && host.liveQueryRows === true
            ? { row: request.row.name }
            : {}),
        },
      });
      setStatus('loading');

      // Applies a checked update to the store rows; returns them in view order.
      const applyStore = (
        result: Extract<EntityFilterCacheResult, { kind: 'live-query' }>
      ): readonly LiveQueryRow<T>[] => {
        let orderChanged =
          result.reset ||
          result.keys !== undefined ||
          result.removed.length > 0;
        if (result.reset) {
          setRows(reconcile({}));
        }
        for (const key of result.removed) {
          setRows(key, undefined!);
        }
        for (const row of result.upserts) {
          if (!rows[row.recordKey]) orderChanged = true;
          setRows(
            row.recordKey,
            reconcile(row as LiveQueryRow<T>, {
              key: 'id',
              merge: true,
            })
          );
          touchRowVersion(row.recordKey);
        }
        for (const patch of result.patches) {
          setRows(
            patch.recordKey,
            produce((row) => {
              for (const field of patch.fields) {
                if (!field.path.length) {
                  row.record = field.value as T;
                  continue;
                }
                let parent: unknown = row.record;
                for (const segment of field.path.slice(0, -1)) {
                  parent = (parent as Record<string | number, unknown>)[
                    segment
                  ];
                }
                (parent as Record<string | number, unknown>)[
                  field.path[field.path.length - 1]
                ] = field.value;
              }
              row.identity = patch.identity;
            })
          );
          touchRowVersion(patch.recordKey);
        }
        if (result.keys !== undefined) keys = result.keys;
        if (orderChanged)
          orderedRows = keys.flatMap((key) => (rows[key] ? [rows[key]] : []));
        return orderedRows;
      };

      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      const run = async () => {
        if (running || !active) return;
        running = true;
        let staleReads = 0;
        try {
          while (pending && active) {
            pending = false;
            changedDuringRead = false;
            const observedEpoch = epoch;
            let outcome: 'success' | 'unsupported' | 'error' | 'discarded' =
              'discarded';
            let upserts = 0;
            let patches = 0;
            let removed = 0;
            let retries = 0;
            const startedAt = performance.now();
            try {
              const result = await host.entityFilter(args());
              if (!active || epoch !== observedEpoch) {
                staleReads = 0;
                continue;
              }
              if (result.kind !== 'live-query') {
                outcome = 'unsupported';
                unsupported = true;
                observationId = undefined;
                pending = false;
                setStatus('unsupported');
                continue;
              }
              upserts = result.upserts.length;
              patches = result.patches.length;
              removed = result.removed.length;
              const revision = parseCacheRevision(result.revision);
              if (latest !== undefined && BigInt(revision) < BigInt(latest)) {
                staleReads += 1;
                if (staleReads >= MAX_STALE_READS) {
                  // Preserve an invalidation that arrived during this read, but
                  // yield before starting another bounded attempt.
                  if (pending || changedDuringRead) {
                    retryTimer = setTimeout(() => {
                      retryTimer = undefined;
                      deferral.request();
                    }, 0);
                  }
                  pending = false;
                  changedDuringRead = false;
                  throw new Error(
                    'Cache predicate repeatedly returned a stale revision'
                  );
                }
                retries = 1;
                pending = true;
                continue;
              }
              staleReads = 0;
              if (result.reset && result.keys === undefined)
                throw new Error('live query reset omitted its keys');
              // Check row envelopes and patch bases before updating reactive state.
              for (const row of result.upserts) {
                if (
                  !row.recordKey ||
                  row.record === null ||
                  typeof row.record !== 'object' ||
                  Array.isArray(row.record)
                ) {
                  throw new Error('invalid live query record');
                }
              }
              for (const patch of result.patches) {
                if (
                  result.reset ||
                  !(immutable
                    ? immutable.has(patch.recordKey)
                    : untrack(() => rows[patch.recordKey]))
                )
                  throw new Error('live query patch has no base row');
              }
              // The reply says whether the engine shaped it: a host can stop
              // shaping, or be swapped, while a read is in flight.
              const shaped = result.row !== undefined;
              // A reply of the other shape than the rows held is a delta that
              // cannot apply: read the view afresh.
              if (
                immutable &&
                lastShaped !== undefined &&
                lastShaped !== shaped &&
                !result.reset
              ) {
                since = undefined;
                retries = 1;
                pending = true;
                continue;
              }
              untrack(() =>
                batch(() => {
                  if (immutable) {
                    orderedRows = immutable.apply(result, shaped);
                    lastShaped = shaped;
                    if (result.keys !== undefined) keys = result.keys;
                  } else orderedRows = applyStore(result);
                  since = revision;
                  observationId = result.observationId;
                  setData({
                    revision,
                    keys,
                    records: orderedRows,
                    retainedKeys: result.retainedKeys,
                    optimistic: result.optimistic,
                    baselineKeys,
                  });
                  setError(undefined);
                  setStatus('ready');
                })
              );
              outcome = 'success';
            } catch (cause) {
              if (!active || epoch !== observedEpoch) {
                staleReads = 0;
                continue;
              }
              outcome = 'error';
              observationId = undefined;
              // Ask through the deferral: a tab hidden since the read began waits.
              if (changedDuringRead) deferral.request();
              setError(() => cause);
              setStatus('error');
            } finally {
              soupCacheTelemetry.record('predicate', {
                durationMs: performance.now() - startedAt,
                rows: orderedRows.length,
                upserts,
                patches,
                removed,
                retries,
                error: outcome === 'error',
                discarded: outcome === 'discarded',
                incomplete: outcome === 'unsupported',
              });
            }
          }
        } finally {
          running = false;
        }
      };
      const refresh = () => {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        if (unsupported) return;
        pending = true;
        if (!running) runPromise = run();
      };
      requestRefresh = refresh;
      // Every open tab shares one cache engine. A hidden tab keeps a dirty bit
      // instead of reading on each revision; initial and explicit reads still run.
      const deferral = createHiddenDeferral(refresh);
      const unsubscribeChanges = host.onCacheChanged(
        (revision, changes) => {
          if (
            !running &&
            !pending &&
            observationId !== undefined &&
            changes?.unchangedViews?.includes(observationId)
          ) {
            latest = laterRevision(latest, revision);
            return;
          }
          observationId = undefined;
          latest = laterRevision(latest, revision);
          // The running read either reaches this revision, or is stale and
          // reads again (the check against `latest`).
          if (running) {
            changedDuringRead = true;
            return;
          }
          deferral.request();
        },
        { includeHydration: true }
      );
      const unsubscribeGeneration = host.onCacheGenerationChanged(() => {
        epoch += 1;
        unsupported = false;
        since = undefined;
        latest = undefined;
        observationId = undefined;
        batch(() => {
          setData(undefined);
          setStatus('loading');
        });
        deferral.request();
      });
      refresh();
      onCleanup(() => {
        active = false;
        clearTimeout(retryTimer);
        deferral.dispose();
        unsubscribeChanges();
        unsubscribeGeneration();
        // Serialize release after any pending read, so disposal cannot recreate
        // a view behind its cleanup. LRU eviction is a fallback for a lost host.
        const release = async () => {
          try {
            await runPromise;
            await host.entityFilter(args(true));
          } catch {
            /* Host may have retired. */
          }
        };
        fireAndForget(release(), 'soup-predicate-query');
      });
    })
  );
  usePending('soup.cache', () => status() === 'loading');
  return { data, status, error, refresh: () => requestRefresh() };
}
