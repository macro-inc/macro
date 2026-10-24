import type { CacheHost } from '@graphql-cache/host/types';
import type {
  AttentionFeedOrder,
  AttentionFeedShape,
} from './attention-feed-types';

/** Sub-millisecond digits of an RFC 3339 time, which `Date.parse` drops. */
function subMillis(time: string): number {
  const fraction = /\.(\d+)/.exec(time)?.[1] ?? '';
  return Number(fraction.padEnd(9, '0').slice(3, 9));
}

/** `<entity type>:<entity id>` keys end in the server's tiebreaker. */
const entityIdOf = (key: string) => key.slice(key.indexOf(':') + 1);

/** The server's feed order: newest first, then entity id descending. */
export function compareAttentionFeedEntries<Entry>(
  order: AttentionFeedOrder<Entry>
): (a: Entry, b: Entry) => number {
  return (a, b) => {
    const left = order.sortAt(a);
    const right = order.sortAt(b);
    const millis = Date.parse(right) - Date.parse(left);
    if (millis !== 0) return millis;
    const sub = subMillis(right) - subMillis(left);
    if (sub !== 0) return sub;
    const leftId = entityIdOf(order.key(a));
    const rightId = entityIdOf(order.key(b));
    return leftId < rightId ? 1 : leftId > rightId ? -1 : 0;
  };
}

/**
 * Apply one server batch to a feed's loaded pages, in order. A removed entry
 * leaves whichever page holds it; an upserted entry moves to its place in
 * the server's order, or waits for its page when it is older than every
 * loaded row and more remain. Keyset cursors are positions in that order, so
 * a row inserted into one page leaves no gap before the next. Returns
 * undefined when the batch invalidates the feed.
 */
export function placeAttentionFeedPatches<Entry, Patch>(
  shape: Pick<
    AttentionFeedShape<unknown, Entry, Patch>,
    'key' | 'sortAt' | 'change'
  >,
  pages: readonly (readonly Entry[])[],
  patches: readonly Patch[],
  hasMore: boolean
): Entry[][] | undefined {
  const compare = compareAttentionFeedEntries(shape);
  let next = pages.map((page) => [...page]);
  for (const patch of patches) {
    const change = shape.change(patch);
    if (change.kind === 'invalidated') return undefined;
    const key =
      change.kind === 'removed' ? change.key : shape.key(change.entry);
    next = next.map((page) => page.filter((row) => shape.key(row) !== key));
    if (change.kind !== 'upserted') continue;
    const page = next.find((rows) =>
      rows.some((row) => compare(change.entry, row) < 0)
    );
    if (page) {
      page.splice(
        page.findIndex((row) => compare(change.entry, row) < 0),
        0,
        change.entry
      );
    } else if (!hasMore) {
      next.at(-1)?.push(change.entry);
    }
  }
  return next;
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
  patches: readonly Patch[],
  hasMore: boolean
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
  const placed = placeAttentionFeedPatches(shape, loaded, patches, hasMore);
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
