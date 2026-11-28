import type { OperationResult } from '@urql/core';
import {
  $PROXY,
  type Accessor,
  batch,
  createSignal,
  type Signal,
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { supportsStoreReconciliation } from '../../urql-solid/reactive-selection';
import { queryDelta } from './query-patches';
import {
  isIdentityPath,
  type QueryShape,
  RECONCILE_KEY,
  shapeAtPath,
  storeValue,
} from './query-shape';

const LIVE_DATA = Symbol('live-query-data');
const QUERY_SNAPSHOT = Symbol('query-snapshot');
const LIVE_ROW_LAZY = Symbol('live-row-lazy');
type RowVersionEntry = Accessor<unknown> | typeof LIVE_ROW_LAZY;
const rowVersions = new WeakMap<object, RowVersionEntry>();
const lazyRowSignals = new WeakMap<object, Signal<number>>();

function ensureLazyRowSignal(rawRow: object): Signal<number> {
  let signal = lazyRowSignals.get(rawRow);
  if (!signal) {
    signal = createSignal(0);
    lazyRowSignals.set(rawRow, signal);
  }
  return signal;
}

/**
 * Unwraps a Solid store proxy in O(1) without recursively walking plain
 * objects (which `solid-js/store`'s `unwrap` otherwise traverses with
 * `Object.getOwnPropertyDescriptors`).
 */
export function unwrapStoreProxy<T extends object>(value: T): T {
  return Reflect.get(value, $PROXY) === value ? unwrap(value) : value;
}

/**
 * Associates an unwrapped store-backed record with a coarse version signal so
 * whole-row projections can track updates without allocating Solid store nodes
 * for every nested field and array element.
 */
export function registerRowVersion(
  rawRecord: object,
  readVersion: Accessor<unknown>
): void {
  rowVersions.set(rawRecord, readVersion);
}

/**
 * Marks an unwrapped store-backed record for lazy coarse version tracking
 * without retaining its owning query or allocating a signal until read.
 */
export function markRowVersioned(rawRecord: object): void {
  if (!rowVersions.has(rawRecord)) {
    rowVersions.set(rawRecord, LIVE_ROW_LAZY);
  }
}

/**
 * Marks an unwrapped record versioned and notifies any active `readRowSnapshot`
 * subscribers for that record without retaining its owning query.
 */
export function bumpRowVersion(rawRecord: object): void {
  markRowVersioned(rawRecord);
  const signal = lazyRowSignals.get(rawRecord);
  if (signal) signal[1]((version) => version + 1);
}

/**
 * Subscribes to a registered record's coarse version signal and returns its
 * unwrapped object; unregistered values are returned unchanged so ad-hoc
 * stores keep fine-grained tracking.
 */
export function readRowSnapshot<T extends object>(record: T): T {
  const raw = unwrapStoreProxy(record);
  const entry = rowVersions.get(raw);
  if (!entry) return record;
  if (entry === LIVE_ROW_LAZY) {
    ensureLazyRowSignal(raw)[0]();
  } else {
    entry();
  }
  return raw;
}

/**
 * `readRowSnapshot`, plus the version it subscribed to, so a consumer can tell
 * an in-place update from no change. An unregistered value is immutable and
 * has no version (`undefined`).
 */
export function readRowVersion<T extends object>(
  record: T
): { raw: T; version: unknown } {
  const raw = unwrapStoreProxy(record);
  const entry = rowVersions.get(raw);
  if (!entry) return { raw: record, version: undefined };
  const version =
    entry === LIVE_ROW_LAZY ? ensureLazyRowSignal(raw)[0]() : entry();
  return { raw, version };
}

/** Immutable evidence for consumers that compare earlier query results. */
export function querySnapshot<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data;
  const snapshot = Reflect.get(data, QUERY_SNAPSHOT) as T | undefined;
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
  private readonly source = createSignal<Record<string, unknown>>({});
  private readonly knownRows = new WeakSet<object>();
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

  private registerRow(rawRow: object): void {
    if (this.knownRows.has(rawRow)) return;
    this.knownRows.add(rawRow);
    markRowVersioned(rawRow);
  }

  private bumpRow(rawRow: object): void {
    this.registerRow(rawRow);
    bumpRowVersion(rawRow);
  }

  /** Register identified list items lazily and bump only changed rows. */
  private syncLiveQueryRows(value: unknown, unchanged?: WeakSet<object>): void {
    if (value === null || typeof value !== 'object') return;
    const raw = unwrapStoreProxy(value);
    if (unchanged?.has(raw)) return;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item === null || typeof item !== 'object') continue;
        const rawItem = unwrapStoreProxy(item);
        if (typeof Reflect.get(rawItem, RECONCILE_KEY) === 'string') {
          if (unchanged?.has(rawItem)) this.registerRow(rawItem);
          else this.bumpRow(rawItem);
        } else {
          this.syncLiveQueryRows(rawItem, unchanged);
        }
      }
      return;
    }
    if (typeof Reflect.get(raw, RECONCILE_KEY) === 'string') {
      if (unchanged?.has(raw)) this.registerRow(raw);
      else this.bumpRow(raw);
      return;
    }
    for (const child of Object.values(raw)) {
      if (child !== null && typeof child === 'object') {
        this.syncLiveQueryRows(child, unchanged);
      }
    }
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
          this.source[1](() => this.snapshot);
          const unchanged = new WeakSet<object>();
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
                        previous,
                        unchanged
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
          const rawRoot = unwrap(this.state.data);
          for (const { path } of delta.patches) {
            let current: unknown = rawRoot;
            let rowOwner: object | undefined;
            for (const part of path) {
              if (current === null || typeof current !== 'object') {
                current = undefined;
                break;
              }
              current = (current as Record<string | number, unknown>)[part];
              if (
                current !== null &&
                typeof current === 'object' &&
                this.knownRows.has(current)
              ) {
                rowOwner = current;
              }
            }
            if (rowOwner) this.bumpRow(rowOwner);
            else if (current !== null && typeof current === 'object')
              this.syncLiveQueryRows(current, unchanged);
          }
        })
      );
      return;
    }
    const previousSnapshot = this.snapshot;
    this.snapshot = data;
    untrack(() =>
      batch(() => {
        const unchanged = new WeakSet<object>();
        // Network/worker snapshots remain immutable and independent of store ownership.
        this.setState(
          'data',
          reconcile(
            storeValue(
              data,
              this.shape,
              unwrap(this.state.data),
              previousSnapshot,
              unchanged
            ) as Record<string, unknown>,
            {
              key: RECONCILE_KEY,
              merge: false,
            }
          )
        );
        const raw = unwrap(this.state.data);
        this.syncLiveQueryRows(raw, unchanged);
        if (!Object.hasOwn(raw, QUERY_SNAPSHOT)) {
          Object.defineProperty(raw, QUERY_SNAPSHOT, {
            get: () => this.source[0](),
          });
        }
        this.source[1](() => this.snapshot);
      })
    );
  }
}

export const isQueryObject = isObject;
