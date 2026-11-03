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
import { arrayEquals } from '../../../core/util/compareUtils';
import type { RecordSelection } from '../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../graphql-cache/host/types';
import {
  type CacheRevision,
  type EntityFilterCacheArgs,
  parseCacheRevision,
} from '../../../graphql-cache/protocol';
import { subscribeToVisibleCacheChanges } from '../../subscribe-to-visible-cache-changes';
import { soupCacheTelemetry } from './cache-activity-telemetry';

/** A declared source and generated fragment; no mutation-specific query updates. */
export type PredicateQueryRequest<T> = {
  source: Omit<EntityFilterCacheArgs, 'liveQuery' | 'mail'> & {
    baseline: NonNullable<EntityFilterCacheArgs['baseline']>;
  };
  select: RecordSelection<T>;
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
};

type LiveQueryHost = Pick<
  CacheHost,
  'entityFilter' | 'onCacheChanged' | 'onCacheGenerationChanged'
>;

export type PredicateQueryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'error';
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
  const [observationId, setObservationId] = createSignal<string>();
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
      setObservationId(undefined);
      setData(undefined);
      setError(undefined);
      if (!request || !host) {
        setStatus('idle');
        requestRefresh = () => {};
        return;
      }
      const id = crypto.randomUUID();
      const [rows, setRows] = createStore<Record<string, LiveQueryRow<T>>>({});
      let keys: readonly string[] = [];
      let orderedRows: readonly LiveQueryRow<T>[] = [];
      let since: CacheRevision | undefined;
      let latest: CacheRevision | undefined;
      let epoch = 0;
      let active = true;
      let running = false;
      let pending = false;
      let unsupported = false;
      let runPromise: Promise<void> | undefined;
      const args = (release = false): EntityFilterCacheArgs => ({
        ...request.source,
        liveQuery: {
          id,
          ...request.select,
          since,
          ...(release ? { release } : {}),
        },
      });
      setStatus('loading');

      const run = async () => {
        if (running || !active) return;
        running = true;
        try {
          while (pending && active) {
            pending = false;
            const observedEpoch = epoch;
            let outcome: 'success' | 'unsupported' | 'error' | 'discarded' =
              'discarded';
            let upserts = 0;
            let patches = 0;
            let removed = 0;
            const startedAt = performance.now();
            try {
              const result = await host.entityFilter(args());
              if (!active || epoch !== observedEpoch) continue;
              if (result.kind !== 'live-query') {
                outcome = 'unsupported';
                unsupported = true;
                pending = false;
                setStatus('unsupported');
                continue;
              }
              upserts = result.upserts.length;
              patches = result.patches.length;
              removed = result.removed.length;
              const revision = parseCacheRevision(result.revision);
              if (latest !== undefined && BigInt(revision) < BigInt(latest)) {
                continue;
              }
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
                if (result.reset || !untrack(() => rows[patch.recordKey]))
                  throw new Error('live query patch has no base row');
              }
              untrack(() =>
                batch(() => {
                  let orderChanged =
                    result.reset ||
                    (result.keys !== undefined &&
                      !arrayEquals(keys, result.keys)) ||
                    result.removed.length > 0;
                  if (result.reset) setRows(reconcile({}));
                  for (const key of result.removed) setRows(key, undefined!);
                  for (const row of result.upserts) {
                    if (!rows[row.recordKey]) orderChanged = true;
                    setRows(
                      row.recordKey,
                      reconcile(row as LiveQueryRow<T>, {
                        key: 'id',
                        merge: true,
                      })
                    );
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
                            parent = (
                              parent as Record<string | number, unknown>
                            )[segment];
                          }
                          (parent as Record<string | number, unknown>)[
                            field.path[field.path.length - 1]
                          ] = field.value;
                        }
                        row.identity = patch.identity;
                      })
                    );
                  }
                  if (result.keys !== undefined && orderChanged)
                    keys = result.keys;
                  if (orderChanged)
                    orderedRows = keys.flatMap((key) =>
                      rows[key] ? [rows[key]] : []
                    );
                  since = revision;
                  setObservationId(result.observationId);
                  setData({
                    revision,
                    keys,
                    records: orderedRows,
                    retainedKeys: result.retainedKeys,
                    optimistic: result.optimistic,
                  });
                  setError(undefined);
                  setStatus('ready');
                })
              );
              outcome = 'success';
            } catch (cause) {
              if (!active || epoch !== observedEpoch) continue;
              outcome = 'error';
              setError(() => cause);
              setStatus('error');
            } finally {
              soupCacheTelemetry.record('predicate', {
                durationMs: performance.now() - startedAt,
                rows: orderedRows.length,
                upserts,
                patches,
                removed,
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
      const refresh = (): Promise<void> => {
        if (unsupported) return runPromise ?? Promise.resolve();
        pending = true;
        if (!running) runPromise = run();
        return runPromise ?? Promise.resolve();
      };
      requestRefresh = () => fireAndForget(refresh(), 'soup-predicate-query');
      const unsubscribeChanges = subscribeToVisibleCacheChanges(host, refresh, {
        observation: observationId,
        onChange: (revision) => {
          latest = revision;
        },
      });
      const unsubscribeGeneration = host.onCacheGenerationChanged(() => {
        epoch += 1;
        unsupported = false;
        since = undefined;
        setObservationId(undefined);
        latest = undefined;
        batch(() => {
          setData(undefined);
          setStatus('loading');
        });
        fireAndForget(refresh(), 'soup-predicate-query');
      });
      fireAndForget(refresh(), 'soup-predicate-query');
      onCleanup(() => {
        active = false;
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
  return {
    data,
    observationId,
    status,
    error,
    refresh: () => requestRefresh(),
  };
}
