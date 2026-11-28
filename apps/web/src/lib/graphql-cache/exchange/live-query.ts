import type { OperationResult } from '@urql/core';
import { $PROXY, batch, createSignal, untrack } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { supportsStoreReconciliation } from '../../urql-solid/reactive-selection';
import { queryDelta } from './query-patches';
import {
  isIdentityPath,
  type QueryShape,
  RECONCILE_KEY,
  shapeAtPath,
  shareQueryPatches,
  shareQueryValue,
  storeValue,
} from './query-shape';

const LIVE_DATA = Symbol('live-query-data');
const QUERY_SNAPSHOT = Symbol('query-snapshot');
/**
 * Unwraps a Solid store proxy in O(1) without recursively walking plain
 * objects (which `solid-js/store`'s `unwrap` otherwise traverses with
 * `Object.getOwnPropertyDescriptors`).
 */
export function unwrapStoreProxy<T extends object>(value: T): T {
  return Reflect.get(value, $PROXY) === value ? unwrap(value) : value;
}

/** Immutable evidence for consumers that compare earlier query results. */
export function querySnapshot<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data;
  // Read through the raw root: a store proxy would wrap the snapshot it returns.
  const snapshot = Reflect.get(unwrapStoreProxy(data), QUERY_SNAPSHOT) as
    | T
    | undefined;
  return snapshot ?? data;
}

/** Reactive bindings opt into live data; urql result snapshots remain immutable. */
export function withLiveQueryData(
  result: OperationResult,
  data: unknown
): OperationResult {
  return Object.assign(result, { [LIVE_DATA]: data });
}

export function liveQueryData(result: OperationResult): unknown {
  return (
    (result as OperationResult & { [LIVE_DATA]?: unknown })[LIVE_DATA] ??
    result.data
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A query keeps its own selected shape, aliases, and stable reactive objects. */
export class LiveQuery {
  private readonly state;
  private readonly setState;
  private readonly source = createSignal<unknown>({});
  // What `querySnapshot` returns: the latest result, sharing every row the
  // result left unchanged with the one before, so readers compare by identity.
  private shared: unknown;
  // The result `shared` mirrors, so a reused subtree is matched without a walk.
  private sharedSource: unknown;
  // urql's latest result, the base a patched result names.
  snapshot: Record<string, unknown>;

  constructor(
    data: Record<string, unknown>,
    private readonly shape?: QueryShape
  ) {
    [this.state, this.setState] = createStore<{
      data: Record<string, unknown>;
    }>({ data: {} });
    this.snapshot = {};
    this.replace(data);
  }

  get data(): Record<string, unknown> {
    return this.state.data;
  }

  private publish(
    data: Record<string, unknown>,
    patches?: Parameters<typeof shareQueryPatches>[2]
  ): void {
    this.shared =
      (patches &&
        shareQueryPatches(
          this.shared,
          this.sharedSource,
          patches,
          this.shape
        )) ??
      shareQueryValue(data, this.shared, this.shape, this.sharedSource);
    this.sharedSource = data;
    this.source[1](() => this.shared);
  }

  replace(data: Record<string, unknown>): void {
    if (data === this.snapshot) return;
    if (!supportsStoreReconciliation(data))
      throw new Error('query shape requires snapshot fallback');
    const delta = queryDelta(data);
    if (
      delta?.base === this.snapshot &&
      !delta.patches.some((patch) => isIdentityPath(this.shape, patch.path))
    ) {
      this.snapshot = data;
      untrack(() =>
        batch(() => {
          this.publish(data, delta.patches);
          this.setState(
            'data',
            produce((draft) => {
              for (const { path, value } of delta.patches) {
                let parent: unknown = draft;
                for (const part of path.slice(0, -1))
                  parent = (parent as Record<string | number, unknown>)[part];
                const target = parent as Record<string | number, unknown>;
                const field = path[path.length - 1];
                if (value !== null && typeof value === 'object') {
                  // The replaced value's previous snapshot lets unchanged rows
                  // keep their store objects instead of being rebuilt.
                  let previous: unknown = delta.base;
                  for (const part of path)
                    previous = (previous as Record<string | number, unknown>)[
                      part
                    ];
                  // Reconcile just the changed subtree to retain keyed rows and
                  // unchanged field observers. A wrapper also allows its root
                  // to be replaced when the value's type or identity changes.
                  const current = unwrap(target[field]);
                  const next = reconcile(
                    {
                      value: storeValue(
                        value,
                        shapeAtPath(this.shape, path),
                        current,
                        previous
                      ),
                    },
                    { key: RECONCILE_KEY, merge: false }
                  )({ value: current }).value;
                  // Reassigning an in-place reconciliation would only make
                  // the draft unwrap the whole subtree again.
                  if (next !== current) target[field] = next;
                } else {
                  target[field] = value;
                }
              }
            })
          );
        })
      );
      return;
    }
    const previousSnapshot = this.snapshot;
    this.snapshot = data;
    untrack(() =>
      batch(() => {
        // Network/worker snapshots remain immutable and independent of store ownership.
        this.setState(
          'data',
          reconcile(
            storeValue(
              data,
              this.shape,
              unwrap(this.state.data),
              previousSnapshot
            ) as Record<string, unknown>,
            {
              key: RECONCILE_KEY,
              merge: false,
            }
          )
        );
        const raw = unwrap(this.state.data);
        if (!Object.hasOwn(raw, QUERY_SNAPSHOT)) {
          Object.defineProperty(raw, QUERY_SNAPSHOT, {
            get: () => this.source[0](),
          });
        }
        this.publish(data);
      })
    );
  }
}

export const isQueryObject = isObject;
