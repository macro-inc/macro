import type { CacheHost } from '@graphql-cache/host/types';
import {
  WorkFeedDocument,
  type WorkFeedEntryFieldsFragment,
  type WorkFeedPatchFieldsFragment,
  type WorkFeedQuery,
  type WorkFeedQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { stringifyDocument } from '@urql/core';

type Entry = WorkFeedEntryFieldsFragment;
/** A place in the feed's order; a page's `nextPosition` is where its read stopped. */
type Position = NonNullable<WorkFeedQuery['user']['workFeed']['nextPosition']>;

const workFeedQuery = stringifyDocument(WorkFeedDocument);

/** Sub-millisecond digits of an RFC 3339 time, which `Date.parse` drops. */
function subMillis(time: string): number {
  const fraction = /\.(\d+)/.exec(time)?.[1] ?? '';
  return Number(fraction.padEnd(9, '0').slice(3, 9));
}

/** `<entity type>:<entity id>` item ids end in the server's tiebreaker. */
const entityIdOf = (itemId: string) => itemId.slice(itemId.indexOf(':') + 1);

/** The server's feed order: newest `sortAt` first, then entity id descending. */
function comparePositions(a: Position, b: Position): number {
  const millis = Date.parse(b.sortAt) - Date.parse(a.sortAt);
  if (millis !== 0) return millis;
  const sub = subMillis(b.sortAt) - subMillis(a.sortAt);
  if (sub !== 0) return sub;
  return a.entityId < b.entityId ? 1 : a.entityId > b.entityId ? -1 : 0;
}

const positionOf = (entry: Entry): Position => ({
  sortAt: entry.sortAt,
  entityId: entityIdOf(entry.item.id),
});

/** Entries in the server's feed order. */
export const compareWorkFeedEntries = (a: Entry, b: Entry): number =>
  comparePositions(positionOf(a), positionOf(b));

/** Insert an entry before the first loaded row it sorts ahead of. */
function insertEntry(pages: Entry[][], entry: Entry, next: Position | null) {
  for (const page of pages) {
    const index = page.findIndex(
      (row) => compareWorkFeedEntries(entry, row) < 0
    );
    if (index !== -1) {
      page.splice(index, 0, entry);
      return;
    }
  }
  // Older than every loaded row. The last page's read may have gone past
  // its last row, so the entry is its own while it falls within that read;
  // past it, the entry arrives with a later page.
  if (!next || comparePositions(positionOf(entry), next) <= 0) {
    pages.at(-1)?.push(entry);
  }
}

/**
 * Apply one server batch to a feed's loaded pages, in order. A removed item
 * leaves whichever page holds it; an upserted entry moves to its place in
 * the server's order. Keyset cursors are positions in that order, so a row
 * inserted into one page leaves no gap before the next. `next` is where the
 * last loaded page's read stopped, null once the feed is exhausted. Returns
 * undefined when the batch invalidates the feed.
 */
export function placeWorkFeedPatches(
  pages: readonly (readonly Entry[])[],
  patches: readonly WorkFeedPatchFieldsFragment[],
  next: Position | null
): Entry[][] | undefined {
  let placed = pages.map((page) => [...page]);
  for (const patch of patches) {
    if (patch.__typename === 'WorkFeedInvalidated') return undefined;
    const itemId =
      patch.__typename === 'WorkFeedEntryRemoved'
        ? patch.itemId
        : patch.entry.item.id;
    placed = placed.map((page) => page.filter((row) => row.item.id !== itemId));
    if (patch.__typename === 'WorkFeedEntryUpserted') {
      insertEntry(placed, patch.entry, next);
    }
  }
  return placed;
}

const sameEntries = (a: readonly Entry[], b: readonly Entry[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * Write one server batch into a feed's cached pages, so every query reading
 * them updates without a network read. Resolves false when the batch cannot
 * be placed — an invalidation, or a page the cache no longer holds — and the
 * feed must be read again.
 */
export async function writeWorkFeedPatches(
  host: Pick<CacheHost, 'readQuery' | 'writeQuery'>,
  pageVariables: readonly WorkFeedQueryVariables[],
  patches: readonly WorkFeedPatchFieldsFragment[]
): Promise<boolean> {
  if (pageVariables.length === 0) return false;
  const pages: WorkFeedQuery[] = [];
  for (const variables of pageVariables) {
    const read = await host.readQuery({
      query: workFeedQuery,
      operationName: 'WorkFeed',
      variables,
      priority: 'user-visible',
    });
    if (read.kind !== 'hit') return false;
    // The generated document defines the normalized cache result's shape.
    pages.push(read.data as WorkFeedQuery);
  }
  const placed = placeWorkFeedPatches(
    pages.map((page) => page.user.workFeed.entries),
    patches,
    pages.at(-1)?.user.workFeed.nextPosition ?? null
  );
  if (!placed) return false;
  for (const [index, entries] of placed.entries()) {
    const page = pages[index];
    if (sameEntries(entries, page.user.workFeed.entries)) continue;
    await host.writeQuery({
      query: workFeedQuery,
      operationName: 'WorkFeed',
      variables: pageVariables[index],
      data: {
        ...page,
        user: { ...page.user, workFeed: { ...page.user.workFeed, entries } },
      } satisfies WorkFeedQuery,
    });
  }
  return true;
}
