import * as A from '@automerge/automerge';
import {
  type AutomergeDoc,
  emptyList,
  isList,
  listKeys,
  type Path,
  plain,
  scalar,
} from './document';
import type { InferType, SchemaType } from './schema';

export * from './schema';

export enum SyncDirection {
  TO_AUTOMERGE = 'to-document',
  FROM_AUTOMERGE = 'from-document',
}
export type UpdateMetadata = {
  direction: SyncDirection;
  tags?: string[];
  origin?: string;
};

/** Reconcile JSON into existing native objects; text edits remain CRDT splices. */
export function reconcile(
  draft: any,
  desired: any,
  schema?: SchemaType,
  root = draft,
  path: Path = []
): void {
  if (Array.isArray(desired)) {
    const listSchema = schema && 'itemSchema' in schema ? schema : undefined;
    const selector = listSchema?.idSelector ?? ((value: any) => value?.$?.id);
    const identity = (value: any) => {
      if (value === undefined) return undefined;
      const id = selector(value);
      return id instanceof A.ImmutableString ? id.toString() : id;
    };
    const original = listKeys(draft);
    const used = new Set<string>();
    const wanted: string[] = [];
    for (let index = 0; index < desired.length; index++) {
      const next = desired[index];
      const id = identity(next);
      let key = original.find(
        (key) =>
          !used.has(key) &&
          (id !== undefined
            ? identity(plain(draft.items[key])) === id
            : JSON.stringify(plain(draft.items[key])) === JSON.stringify(next))
      );
      if (
        !key &&
        id === undefined &&
        original[index] &&
        !used.has(original[index])
      )
        key = original[index];
      key ??= crypto.randomUUID();
      used.add(key);
      wanted.push(key);
      assign(draft.items, key, next, listSchema?.itemSchema, root, [
        ...path,
        'items',
      ]);
    }
    // Ordering holds references. Moving references never recreates edited objects.
    for (let index = draft.order.length - 1; index >= 0; index--)
      if (!used.has(String(draft.order[index]))) draft.order.splice(index, 1);
    for (let index = 0; index < wanted.length; index++) {
      if (String(draft.order[index]) === wanted[index]) continue;
      for (let later = draft.order.length - 1; later >= index; later--)
        if (String(draft.order[later]) === wanted[index])
          draft.order.splice(later, 1);
      draft.order.splice(index, 0, new A.ImmutableString(wanted[index]));
    }
    if (draft.order.length > wanted.length) draft.order.splice(wanted.length);
    return;
  }
  const definition = schema && 'definition' in schema ? schema.definition : {};
  for (const key of Object.keys(draft))
    if (!(key in desired) && definition[key]?.type !== 'ignore')
      delete draft[key];
  for (const [key, value] of Object.entries(desired)) {
    if (value === undefined || definition[key]?.type === 'ignore') continue;
    assign(draft, key, value, definition[key], root, path);
  }
}
function assign(
  parent: any,
  key: string | number,
  next: any,
  schema: SchemaType | undefined,
  root: any,
  path: Path
) {
  const current = parent[key];
  const target = [...path, key];
  if (
    typeof next === 'string' &&
    (schema?.type === 'automerge-text' ||
      (schema === undefined && typeof current === 'string'))
  ) {
    if (typeof current !== 'string') parent[key] = next;
    else if (current !== next) A.updateText(root, target, next);
  } else if (Array.isArray(next)) {
    if (!isList(current)) parent[key] = emptyList();
    reconcile(parent[key], next, schema, root, target);
  } else if (next !== null && typeof next === 'object') {
    if (
      !current ||
      typeof current !== 'object' ||
      current instanceof A.ImmutableString ||
      Array.isArray(current)
    )
      parent[key] = {};
    reconcile(parent[key], next, schema, root, target);
  } else if (
    (current instanceof A.ImmutableString ? current.toString() : current) !==
    next
  )
    parent[key] = scalar(next);
}

export class Mirror<S extends SchemaType> {
  private listeners = new Set<
    (state: InferType<S>, metadata: UpdateMetadata) => void
  >();
  private unsubscribe: () => void;
  private metadata?: UpdateMetadata;
  readonly doc: AutomergeDoc;
  readonly schema: S;
  constructor(options: {
    doc: AutomergeDoc;
    schema: S;
    initialState?: InferType<S>;
    [key: string]: unknown;
  }) {
    this.doc = options.doc;
    this.schema = options.schema;
    this.unsubscribe = this.doc.subscribe((event) => {
      const metadata = this.metadata ?? {
        direction: SyncDirection.FROM_AUTOMERGE,
        origin: event.origin,
      };
      for (const listener of this.listeners)
        listener(this.getState(), metadata);
    });
    if (options.initialState) this.setState(options.initialState);
  }
  getState(): InferType<S> {
    return this.doc.toJSON();
  }
  setState(
    state: InferType<S> | ((previous: InferType<S>) => InferType<S>),
    options?: { tags?: string | string[] }
  ) {
    const next =
      typeof state === 'function'
        ? (state as (previous: InferType<S>) => InferType<S>)(this.getState())
        : state;
    if (this.schema.type === 'schema')
      for (const [key, child] of Object.entries(this.schema.definition)) {
        if (next[key] !== undefined)
          this.doc.ensureRoot(
            key,
            child.type === 'automerge-text'
              ? 'text'
              : child.type === 'automerge-map'
                ? 'map'
                : 'list'
          );
      }
    this.metadata = {
      direction: SyncDirection.TO_AUTOMERGE,
      tags: typeof options?.tags === 'string' ? [options.tags] : options?.tags,
    };
    try {
      this.doc.mutate((draft) => reconcile(draft, next, this.schema));
      this.doc.commit();
    } finally {
      this.metadata = undefined;
    }
  }
  sync() {
    this.doc.commit();
    return this.getState();
  }
  syncFromAutomerge() {
    return this.getState();
  }
  getContainerIds() {
    return this.doc.getContainerIds();
  }
  subscribe(listener: (state: InferType<S>, metadata: UpdateMetadata) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose() {
    this.unsubscribe();
    this.listeners.clear();
  }
}
