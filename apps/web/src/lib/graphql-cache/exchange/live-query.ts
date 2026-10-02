import type { Operation, OperationResult } from '@urql/core';
import {
  type FieldNode,
  getOperationAST,
  Kind,
  type SelectionSetNode,
} from 'graphql';
import { batch, createSignal, untrack } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import type { RecordFieldChange } from '../protocol';

type Path = (string | number)[];
type Occurrences = Map<string, Map<string, Path[]>>;
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
  private occurrences: Occurrences = new Map();
  private patchable = false;
  snapshot: Record<string, unknown>;

  constructor(
    private readonly operation: Operation,
    data: Record<string, unknown>
  ) {
    this.snapshot = data;
    [this.state, this.setState] = createStore<{
      data: Record<string, unknown>;
    }>({ data: {} });
    this.replace(data);
  }

  get data(): Record<string, unknown> {
    return this.state.data;
  }

  invalidate(): void {
    this.patchable = false;
  }

  replace(data: Record<string, unknown>): void {
    if (data === this.snapshot && this.patchable) return;
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
        this.index();
      })
    );
  }

  /** False means that this query needs its usual cache reread. */
  apply(changes: readonly RecordFieldChange[]): boolean {
    if (!this.patchable) return false;
    const writes: { path: Path; value: string | number | boolean | null }[] =
      [];
    for (const change of changes) {
      const fields = this.occurrences.get(change.key);
      // Unknown dependencies may be synthetic relations or an incomplete query.
      if (!fields || change.kind === 'invalidate') return false;
      for (const [field, value] of Object.entries(change.fields)) {
        // Argument-dependent fields need a schema-aware storage-key projection.
        if (field.includes('(') || field === 'id' || field === '__typename')
          return false;
        for (const path of fields.get(field) ?? [])
          writes.push({ path, value });
      }
    }
    // Preserve immutable urql history with copies only along changed paths.
    const copies = new Map<object, Record<string | number, unknown>>();
    const copy = (value: object): Record<string | number, unknown> => {
      const existing = copies.get(value);
      if (existing) return existing;
      const result = (
        Array.isArray(value) ? [...value] : { ...value }
      ) as Record<string | number, unknown>;
      copies.set(value, result);
      return result;
    };
    if (writes.length) {
      const next = copy(this.snapshot);
      for (const { path, value } of writes) {
        let old = this.snapshot as Record<string | number, unknown>;
        let target = next;
        for (const segment of path.slice(0, -1)) {
          const child = old[segment] as object;
          target[segment] = copy(child);
          old = child as Record<string | number, unknown>;
          target = target[segment] as Record<string | number, unknown>;
        }
        target[path[path.length - 1]] = value;
      }
      this.snapshot = next;
    }
    untrack(() =>
      batch(() => {
        this.source[1](() => this.snapshot);
        this.setState(
          'data',
          produce((draft) => {
            for (const { path, value } of writes) {
              let parent: unknown = draft;
              for (const segment of path.slice(0, -1)) {
                parent = (parent as Record<string | number, unknown>)[segment];
              }
              (parent as Record<string | number, unknown>)[
                path[path.length - 1]
              ] = value;
            }
          })
        );
      })
    );
    return true;
  }

  private index(): void {
    const operation = getOperationAST(this.operation.query);
    this.occurrences = new Map();
    this.patchable = operation?.operation === 'query';
    if (!operation) return;
    const fragments = new Map(
      this.operation.query.definitions.flatMap((definition) =>
        definition.kind === Kind.FRAGMENT_DEFINITION
          ? [[definition.name.value, definition.selectionSet] as const]
          : []
      )
    );

    const selections = (
      sets: readonly SelectionSetNode[],
      seen = new Set<string>()
    ): FieldNode[] =>
      sets.flatMap((set) =>
        set.selections.flatMap((selection): FieldNode[] => {
          if (selection.kind === Kind.FIELD) return [selection];
          if (selection.kind === Kind.INLINE_FRAGMENT)
            return selections([selection.selectionSet], seen);
          if (seen.has(selection.name.value)) return [];
          seen.add(selection.name.value);
          const fragment = fragments.get(selection.name.value);
          return fragment ? selections([fragment], seen) : [];
        })
      );

    const walk = (
      value: unknown,
      sets: readonly SelectionSetNode[],
      path: Path
    ): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, sets, [...path, index]));
        return;
      }
      if (!isObject(value)) return;
      const fields = new Map<string, FieldNode[]>();
      for (const field of selections(sets)) {
        const responseKey = field.alias?.value ?? field.name.value;
        if (!Object.hasOwn(value, responseKey)) continue;
        const group = fields.get(responseKey) ?? [];
        if (
          group.some(
            (other) =>
              other.name.value !== field.name.value ||
              other.arguments?.length ||
              field.arguments?.length
          )
        )
          this.patchable = false;
        group.push(field);
        fields.set(responseKey, group);
      }
      const identity = (name: string): unknown => {
        for (const [responseKey, group] of fields) {
          if (group[0].name.value === name) return value[responseKey];
        }
      };
      const typename = identity('__typename');
      const id = identity('id');
      const key =
        path.length === 0
          ? 'ROOT_QUERY'
          : typeof typename === 'string' && typeof id === 'string'
            ? `${typename}:${id}`
            : undefined;
      const indexed =
        key === undefined
          ? undefined
          : (this.occurrences.get(key) ?? new Map<string, Path[]>());
      if (key !== undefined && indexed) this.occurrences.set(key, indexed);
      for (const [responseKey, group] of fields) {
        const field = group[0];
        const fieldPath = [...path, responseKey];
        if (indexed && !field.arguments?.length && !field.selectionSet) {
          const paths = indexed.get(field.name.value) ?? [];
          paths.push(fieldPath);
          indexed.set(field.name.value, paths);
        }
        const children = group.flatMap((field) =>
          field.selectionSet ? [field.selectionSet] : []
        );
        if (children.length) walk(value[responseKey], children, fieldPath);
      }
    };
    walk(this.state.data, [operation.selectionSet], []);
  }
}

export const isQueryObject = isObject;
