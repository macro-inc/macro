import { describe, expect, it } from 'vitest';
import {
  compareAttentionFeedEntries,
  placeAttentionFeedPatches,
  writeAttentionFeedPatches,
} from './attention-feed-cache';
import type { AttentionFeedShape } from './attention-feed-types';
import { createFakeAttentionFeedClient } from './tests/fake-client';

type Entry = { key: string; sortAt: string };
type Patch =
  | { t: 'upserted'; entry: Entry }
  | { t: 'removed'; key: string }
  | { t: 'invalidated' };
type Page = { feed: { entries: Entry[]; nextCursor: string | null } };

const shape: AttentionFeedShape<Page, Entry, Patch> = {
  key: (entry) => entry.key,
  sortAt: (entry) => entry.sortAt,
  change: (patch) =>
    patch.t === 'upserted'
      ? { kind: 'upserted', entry: patch.entry }
      : patch.t === 'removed'
        ? { kind: 'removed', key: patch.key }
        : { kind: 'invalidated' },
  entries: (page) => page.feed.entries,
  withEntries: (page, entries) => ({ feed: { ...page.feed, entries } }),
};

const documentEntry = (docId: string, sortAt: string): Entry => ({
  key: `document:${docId}`,
  sortAt,
});

const at = (docId: string, minute: number) =>
  documentEntry(docId, `2026-02-01T10:${String(minute).padStart(2, '0')}:00Z`);

const upserted = (entry: Entry): Patch => ({ t: 'upserted', entry });
const removed = (key: string): Patch => ({ t: 'removed', key });
const page = (entries: Entry[], nextCursor: string | null = null): Page => ({
  feed: { entries, nextCursor },
});

const cachedQuery = {
  query: 'query Feed { user { id } }',
  operationName: 'Feed',
};

const ids = (pages: Entry[][] | undefined) =>
  pages?.map((rows) => rows.map((entry) => entry.key.split(':')[1]));

describe('compareAttentionFeedEntries', () => {
  it('orders newest first, then by entity id descending', () => {
    const sorted = [
      documentEntry('a', '2026-02-01T10:00:00.000001Z'),
      documentEntry('b', '2026-02-01T10:00:00Z'),
      documentEntry('c', '2026-02-01T10:00:00Z'),
      documentEntry('d', '2026-02-01T10:00:00.000002Z'),
    ].sort(compareAttentionFeedEntries(shape));
    expect(sorted.map((entry) => entry.key)).toEqual([
      'document:d',
      'document:a',
      'document:c',
      'document:b',
    ]);
  });
});

describe('placeAttentionFeedPatches', () => {
  const pages = [
    [at('p1-a', 50), at('p1-b', 40)],
    [at('p2-a', 30), at('p2-b', 20)],
  ];

  it('removes an entry from whichever page holds it', () => {
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [removed('document:p2-a')],
          true
        )
      )
    ).toEqual([['p1-a', 'p1-b'], ['p2-b']]);
  });

  it('places a new entry at its time and moves an existing one', () => {
    const placed = placeAttentionFeedPatches(
      shape,
      pages,
      [upserted(at('new', 45)), upserted(at('p2-b', 55))],
      true
    );
    expect(ids(placed)).toEqual([['p2-b', 'p1-a', 'new', 'p1-b'], ['p2-a']]);
  });

  it('leaves an entry older than every loaded row to its page', () => {
    expect(
      ids(
        placeAttentionFeedPatches(shape, pages, [upserted(at('old', 10))], true)
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b'],
    ]);
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [upserted(at('old', 10))],
          false
        )
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b', 'old'],
    ]);
  });

  it('drops an entry that moved below the loaded rows', () => {
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [upserted(at('p1-a', 10))],
          true
        )
      )
    ).toEqual([['p1-b'], ['p2-a', 'p2-b']]);
  });

  it('gives up on an invalidated batch', () => {
    expect(
      placeAttentionFeedPatches(
        shape,
        pages,
        [upserted(at('new', 45)), { t: 'invalidated' }],
        true
      )
    ).toBeUndefined();
  });
});

describe('writeAttentionFeedPatches', () => {
  const firstPage = { input: { cursor: null } };
  const secondPage = { input: { cursor: 'cursor-2' } };

  it('writes only the cached pages the batch changed', async () => {
    const fake = createFakeAttentionFeedClient();
    for (const variables of [firstPage, secondPage]) {
      fake.client.executeQuery({ variables } as never);
    }
    fake.queries[0].resolve(page([at('a', 50)], 'cursor-2'));
    fake.queries[1].resolve(page([at('b', 30)]));

    const placed = await writeAttentionFeedPatches(
      shape,
      fake.host,
      cachedQuery,
      [firstPage, secondPage],
      [upserted(at('new', 40))],
      false
    );

    expect(placed).toBe(true);
    // Older than the first page's last row, it belongs to the second page.
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].variables).toEqual(secondPage);
    expect(fake.writes[0].data).toEqual(page([at('new', 40), at('b', 30)]));
  });

  it('asks for a read when a page is not cached', async () => {
    const fake = createFakeAttentionFeedClient();
    expect(
      await writeAttentionFeedPatches(
        shape,
        fake.host,
        cachedQuery,
        [firstPage],
        [upserted(at('new', 40))],
        false
      )
    ).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
});
