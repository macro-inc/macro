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

const workFeedQuery = stringifyDocument(WorkFeedDocument);

/** Sub-millisecond digits of an RFC 3339 time, which `Date.parse` drops. */
function subMillis(time: string): number {
  const fraction = /\.(\d+)/.exec(time)?.[1] ?? '';
  return Number(fraction.padEnd(9, '0').slice(3, 9));
}

/** `<entity type>:<entity id>` item ids end in the server's tiebreaker. */
const entityIdOf = (itemId: string) => itemId.slice(itemId.indexOf(':') + 1);

/** The server's feed order: newest `sortAt` first, then entity id descending. */
export function compareWorkFeedEntries(a: Entry, b: Entry): number {
  const millis = Date.parse(b.sortAt) - Date.parse(a.sortAt);
  if (millis !== 0) return millis;
  const sub = subMillis(b.sortAt) - subMillis(a.sortAt);
  if (sub !== 0) return sub;
  const left = entityIdOf(a.item.id);
  const right = entityIdOf(b.item.id);
  return left < right ? 1 : left > right ? -1 : 0;
}

/** Insert an entry before the first loaded row it sorts ahead of. */
function insertEntry(pages: Entry[][], entry: Entry, hasMore: boolean) {
  for (const page of pages) {
    const index = page.findIndex(
      (row) => compareWorkFeedEntries(entry, row) < 0
    );
    if (index !== -1) {
      page.splice(index, 0, entry);
      return;
    }
  }
  // Older than every loaded row: it arrives with its page while more remain.
  if (!hasMore) pages.at(-1)?.push(entry);
}

/**
 * Apply one server batch to a feed's loaded pages, in order. A removed item
 * leaves whichever page holds it; an upserted entry moves to its place in
 * the server's order. Keyset cursors are positions in that order, so a row
 * inserted into one page leaves no gap before the next. Returns undefined
 * when the batch invalidates the feed.
 */
export function placeWorkFeedPatches(
  pages: readonly (readonly Entry[])[],
  patches: readonly WorkFeedPatchFieldsFragment[],
  hasMore: boolean
): Entry[][] | undefined {
  let next = pages.map((page) => [...page]);
  for (const patch of patches) {
    if (patch.__typename === 'WorkFeedInvalidated') return undefined;
    const itemId =
      patch.__typename === 'WorkFeedEntryRemoved'
        ? patch.itemId
        : patch.entry.item.id;
    next = next.map((page) => page.filter((row) => row.item.id !== itemId));
    if (patch.__typename === 'WorkFeedEntryUpserted') {
      insertEntry(next, patch.entry, hasMore);
    }
  }
  return next;
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
  patches: readonly WorkFeedPatchFieldsFragment[],
  hasMore: boolean
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
    hasMore
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
