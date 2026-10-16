import type { GraphicsDocument, GraphicsItem } from './model';

type Change<T> = Readonly<{ before: T; after: T }>;

/** Local-only history. Entries retain changed immutable items, never documents. */
export type DocumentDelta = Readonly<{
  items: readonly Readonly<{ id: string } & Change<GraphicsItem | undefined>>[];
  rootId?: Change<string>;
  surface?: Change<GraphicsDocument['surface']>;
}>;

/** Both documents must have passed freezeDocument before recording history. */
export function documentDelta(
  before: GraphicsDocument,
  after: GraphicsDocument
): DocumentDelta | undefined {
  const items: DocumentDelta['items'][number][] = [];
  for (const id of Object.keys(before.items)) {
    if (before.items[id] !== after.items[id])
      items.push({ id, before: before.items[id], after: after.items[id] });
  }
  for (const id of Object.keys(after.items)) {
    if (!Object.hasOwn(before.items, id))
      items.push({ id, before: undefined, after: after.items[id] });
  }
  const rootId =
    before.rootId !== after.rootId
      ? { before: before.rootId, after: after.rootId }
      : undefined;
  const surface =
    before.surface?.id !== after.surface?.id ||
    before.surface?.width !== after.surface?.width ||
    before.surface?.height !== after.surface?.height
      ? { before: before.surface, after: after.surface }
      : undefined;
  if (!items.length && !rootId && !surface) return;
  return { items, rootId, surface };
}

/** Apply an entire committed transaction atomically, retaining item identities. */
export function applyDocumentDelta(
  document: GraphicsDocument,
  delta: DocumentDelta,
  direction: 'before' | 'after'
): GraphicsDocument {
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    document.items
  );
  for (const change of delta.items) {
    const item = change[direction];
    if (item) items[change.id] = item;
    else delete items[change.id];
  }
  const surface = delta.surface ? delta.surface[direction] : document.surface;
  return Object.freeze({
    rootId: delta.rootId ? delta.rootId[direction] : document.rootId,
    items: Object.freeze(items),
    ...(surface ? { surface } : {}),
  });
}
