import { describe, expect, it } from 'vitest';
import {
  compareAttentionFeedEntries,
  placeAttentionFeedPatches,
  writeAttentionFeedPatches,
} from './attention-feed-cache';
import type {
  AttentionFeedPosition,
  AttentionFeedShape,
} from './attention-feed-types';
import { createFakeAttentionFeedClient } from './tests/fake-client';

type Entry = { key: string; sortAt: string };
type Patch =
  | { t: 'upserted'; entry: Entry }
  | { t: 'removed'; key: string }
  | { t: 'invalidated' };
type Page = {
  feed: {
    entries: Entry[];
    nextCursor: string | null;
    nextPosition: AttentionFeedPosition | null;
  };
};

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
  nextPosition: (page) => page.feed.nextPosition,
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
const page = (
  entries: Entry[],
  nextCursor: string | null = null,
  nextPosition: AttentionFeedPosition | null = null
): Page => ({
  feed: { entries, nextCursor, nextPosition },
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
  // The last page's read stopped at its last row.
  const more = { sortAt: '2026-02-01T10:20:00Z', entityId: 'p2-b' };

  it('removes an entry from whichever page holds it', () => {
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [removed('document:p2-a')],
          more
        )
      )
    ).toEqual([['p1-a', 'p1-b'], ['p2-b']]);
  });

  it('places a new entry at its time and moves an existing one', () => {
    const placed = placeAttentionFeedPatches(
      shape,
      pages,
      [upserted(at('new', 45)), upserted(at('p2-b', 55))],
      more
    );
    expect(ids(placed)).toEqual([['p2-b', 'p1-a', 'new', 'p1-b'], ['p2-a']]);
  });

  it('leaves an entry older than every loaded row to its page', () => {
    expect(
      ids(
        placeAttentionFeedPatches(shape, pages, [upserted(at('old', 10))], more)
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
          null
        )
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b', 'old'],
    ]);
  });

  it('keeps an entry the last page read past its rows', () => {
    // A filtered page read on to minute 5 after its last row at minute 20.
    const readPast = { sortAt: '2026-02-01T10:05:00Z', entityId: 'skipped' };
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [upserted(at('gap', 10))],
          readPast
        )
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b', 'gap'],
    ]);
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [upserted(at('later', 1))],
          readPast
        )
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b'],
    ]);
  });

  it('drops an entry that moved below the loaded rows', () => {
    expect(
      ids(
        placeAttentionFeedPatches(
          shape,
          pages,
          [upserted(at('p1-a', 10))],
          more
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
        more
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
      [upserted(at('new', 40))]
    );

    expect(placed).toBe(true);
    // Older than the first page's last row, it belongs to the second page.
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].variables).toEqual(secondPage);
    expect(fake.writes[0].data).toEqual(page([at('new', 40), at('b', 30)]));
  });

  it('writes an entry the last cached page read past into it', async () => {
    const fake = createFakeAttentionFeedClient();
    const readPast = { sortAt: '2026-02-01T10:05:00Z', entityId: 'skipped' };
    fake.client.executeQuery({ variables: firstPage } as never);
    fake.queries[0].resolve(page([at('a', 50)], 'cursor-2', readPast));

    expect(
      await writeAttentionFeedPatches(
        shape,
        fake.host,
        cachedQuery,
        [firstPage],
        [upserted(at('gap', 20))]
      )
    ).toBe(true);
    expect(fake.writes[0].data).toEqual(
      page([at('a', 50), at('gap', 20)], 'cursor-2', readPast)
    );
  });

  it('asks for a read when a page is not cached', async () => {
    const fake = createFakeAttentionFeedClient();
    expect(
      await writeAttentionFeedPatches(
        shape,
        fake.host,
        cachedQuery,
        [firstPage],
        [upserted(at('new', 40))]
      )
    ).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
});
