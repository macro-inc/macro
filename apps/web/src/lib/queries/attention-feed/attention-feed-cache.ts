import type { CacheHost } from '@graphql-cache/host/types';
import type {
  AttentionFeedOrder,
  AttentionFeedPosition,
  AttentionFeedShape,
} from './attention-feed-types';

/** Sub-millisecond digits of an RFC 3339 time, which `Date.parse` drops. */
function subMillis(time: string): number {
  const fraction = /\.(\d+)/.exec(time)?.[1] ?? '';
  return Number(fraction.padEnd(9, '0').slice(3, 9));
}

/** `<entity type>:<entity id>` keys end in the server's tiebreaker. */
const entityIdOf = (key: string) => key.slice(key.indexOf(':') + 1);

/** The server's feed order: newest `sortAt` first, then entity id descending. */
function comparePositions(
  a: AttentionFeedPosition,
  b: AttentionFeedPosition
): number {
  const millis = Date.parse(b.sortAt) - Date.parse(a.sortAt);
  if (millis !== 0) return millis;
  const sub = subMillis(b.sortAt) - subMillis(a.sortAt);
  if (sub !== 0) return sub;
  return a.entityId < b.entityId ? 1 : a.entityId > b.entityId ? -1 : 0;
}

const positionOf = <Entry>(
  order: AttentionFeedOrder<Entry>,
  entry: Entry
): AttentionFeedPosition => ({
  sortAt: order.sortAt(entry),
  entityId: entityIdOf(order.key(entry)),
});

/** Entries in the server's feed order. */
export function compareAttentionFeedEntries<Entry>(
  order: AttentionFeedOrder<Entry>
): (a: Entry, b: Entry) => number {
  return (a, b) => comparePositions(positionOf(order, a), positionOf(order, b));
}

/**
 * Apply one server batch to a feed's loaded pages, in order. A removed entry
 * leaves whichever page holds it; an upserted entry moves to its place in
 * the server's order. Keyset cursors are positions in that order, so a row
 * inserted into one page leaves no gap before the next. `next` is where the
 * last loaded page's read stopped, null once the feed is exhausted. Returns
 * undefined when the batch invalidates the feed.
 */
export function placeAttentionFeedPatches<Entry, Patch>(
  shape: Pick<
    AttentionFeedShape<unknown, Entry, Patch>,
    'key' | 'sortAt' | 'change'
  >,
  pages: readonly (readonly Entry[])[],
  patches: readonly Patch[],
  next: AttentionFeedPosition | null
): Entry[][] | undefined {
  const compare = compareAttentionFeedEntries(shape);
  let placed = pages.map((page) => [...page]);
  for (const patch of patches) {
    const change = shape.change(patch);
    if (change.kind === 'invalidated') return undefined;
    const key =
      change.kind === 'removed' ? change.key : shape.key(change.entry);
    placed = placed.map((page) => page.filter((row) => shape.key(row) !== key));
    if (change.kind !== 'upserted') continue;
    const page = placed.find((rows) =>
      rows.some((row) => compare(change.entry, row) < 0)
    );
    if (page) {
      page.splice(
        page.findIndex((row) => compare(change.entry, row) < 0),
        0,
        change.entry
      );
    } else if (
      // Older than every loaded row. The last page's read may have gone past
      // its last row, so the entry is its own while it falls within that
      // read; past it, the entry arrives with a later page.
      !next ||
      comparePositions(positionOf(shape, change.entry), next) <= 0
    ) {
      placed.at(-1)?.push(change.entry);
    }
  }
  return placed;
}

const sameEntries = <Entry>(a: readonly Entry[], b: readonly Entry[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** The cached query a feed's pages are stored under. */
export type AttentionFeedCachedQuery = {
  /** The printed query document. */
  query: string;
  operationName: string;
};

/**
 * Write one server batch into a feed's cached pages, so every query reading
 * them updates without a network read. Resolves false when the batch cannot
 * be placed — an invalidation, or a page the cache no longer holds — and the
 * feed must be read again.
 */
export async function writeAttentionFeedPatches<
  Page,
  Entry,
  Patch,
  Variables extends Record<string, unknown>,
>(
  shape: AttentionFeedShape<Page, Entry, Patch>,
  host: Pick<CacheHost, 'readQuery' | 'writeQuery'>,
  cachedQuery: AttentionFeedCachedQuery,
  pageVariables: readonly Variables[],
  patches: readonly Patch[]
): Promise<boolean> {
  if (pageVariables.length === 0) return false;
  const pages: Page[] = [];
  for (const variables of pageVariables) {
    const read = await host.readQuery({
      ...cachedQuery,
      variables,
      priority: 'user-visible',
    });
    if (read.kind !== 'hit') return false;
    // The generated document defines the normalized cache result's shape.
    pages.push(read.data as Page);
  }
  const loaded = pages.map((page) => shape.entries(page));
  const last = pages.at(-1);
  const placed = placeAttentionFeedPatches(
    shape,
    loaded,
    patches,
    (last && shape.nextPosition(last)) ?? null
  );
  if (!placed) return false;
  for (const [index, page] of pages.entries()) {
    const entries = placed[index];
    if (!entries || sameEntries(entries, shape.entries(page))) continue;
    await host.writeQuery({
      ...cachedQuery,
      variables: pageVariables[index],
      data: shape.withEntries(page, entries),
    });
  }
  return true;
}
