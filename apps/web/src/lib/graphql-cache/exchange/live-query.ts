import type { OperationResult } from '@urql/core';
import { batch, createSignal, untrack } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { queryDelta } from './query-patches';

const LIVE_DATA = Symbol('live-query-data');
const QUERY_SNAPSHOT = Symbol('query-snapshot');

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
  snapshot: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    [this.state, this.setState] = createStore<{
      data: Record<string, unknown>;
    }>({ data: {} });
    this.snapshot = {};
    this.replace(data);
  }

  get data(): Record<string, unknown> {
    return this.state.data;
  }

  replace(data: Record<string, unknown>): void {
    if (data === this.snapshot) return;
    const delta = queryDelta(data);
    if (delta?.base === this.snapshot) {
      this.snapshot = data;
      untrack(() =>
        batch(() => {
          this.source[1](() => this.snapshot);
          this.setState(
            'data',
            produce((draft) => {
              for (const { path, value } of delta.patches) {
                let parent: unknown = draft;
                for (const part of path.slice(0, -1))
                  parent = (parent as Record<string | number, unknown>)[part];
                (parent as Record<string | number, unknown>)[
                  path[path.length - 1]
                ] =
                  value !== null && typeof value === 'object'
                    ? structuredClone(value)
                    : value;
              }
            })
          );
        })
      );
      return;
    }
    this.snapshot = data;
    untrack(() =>
      batch(() => {
        // Network/worker snapshots remain immutable and independent of store ownership.
        this.setState(
          'data',
          reconcile(JSON.parse(JSON.stringify(data)), {
            key: 'id',
            merge: true,
          })
        );
        const raw = unwrap(this.state.data);
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
