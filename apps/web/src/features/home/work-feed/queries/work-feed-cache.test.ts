import type { WorkFeedEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it } from 'vitest';
import { createFakeWorkFeedClient } from '../tests/fake-client';
import {
  documentEntry,
  invalidatedPatch,
  removedPatch,
  upsertedPatch,
  workFeedPage,
} from '../tests/wire';
import {
  compareWorkFeedEntries,
  placeWorkFeedPatches,
  writeWorkFeedPatches,
} from './work-feed-cache';

const at = (docId: string, minute: number) =>
  documentEntry({
    docId,
    sortAt: `2026-02-01T10:${String(minute).padStart(2, '0')}:00Z`,
  });

const ids = (pages: WorkFeedEntryFieldsFragment[][] | undefined) =>
  pages?.map((page) => page.map((entry) => entry.item.id.split(':')[1]));

describe('compareWorkFeedEntries', () => {
  it('orders newest first, then by entity id descending', () => {
    const sorted = [
      documentEntry({ docId: 'a', sortAt: '2026-02-01T10:00:00.000001Z' }),
      documentEntry({ docId: 'b', sortAt: '2026-02-01T10:00:00Z' }),
      documentEntry({ docId: 'c', sortAt: '2026-02-01T10:00:00Z' }),
      documentEntry({ docId: 'd', sortAt: '2026-02-01T10:00:00.000002Z' }),
    ].sort(compareWorkFeedEntries);
    expect(sorted.map((entry) => entry.item.id)).toEqual([
      'document:d',
      'document:a',
      'document:c',
      'document:b',
    ]);
  });
});

describe('placeWorkFeedPatches', () => {
  const pages = [
    [at('p1-a', 50), at('p1-b', 40)],
    [at('p2-a', 30), at('p2-b', 20)],
  ];
  // The last page's read stopped at its last row.
  const more = { sortAt: '2026-02-01T10:20:00Z', entityId: 'p2-b' };

  it('removes an item from whichever page holds it', () => {
    expect(
      ids(placeWorkFeedPatches(pages, [removedPatch('document:p2-a')], more))
    ).toEqual([['p1-a', 'p1-b'], ['p2-b']]);
  });

  it('places a new entry at its time and moves an existing one', () => {
    const placed = placeWorkFeedPatches(
      pages,
      [upsertedPatch(at('new', 45)), upsertedPatch(at('p2-b', 55))],
      more
    );
    expect(ids(placed)).toEqual([['p2-b', 'p1-a', 'new', 'p1-b'], ['p2-a']]);
  });

  it('leaves an entry older than every loaded row to its page', () => {
    expect(
      ids(placeWorkFeedPatches(pages, [upsertedPatch(at('old', 10))], more))
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b'],
    ]);
    expect(
      ids(placeWorkFeedPatches(pages, [upsertedPatch(at('old', 10))], null))
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b', 'old'],
    ]);
  });

  it('keeps an entry the last page read past its rows', () => {
    // A filtered page read on to minute 5 after its last row at minute 20.
    const readPast = { sortAt: '2026-02-01T10:05:00Z', entityId: 'skipped' };
    expect(
      ids(placeWorkFeedPatches(pages, [upsertedPatch(at('gap', 10))], readPast))
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b', 'gap'],
    ]);
    expect(
      ids(
        placeWorkFeedPatches(pages, [upsertedPatch(at('later', 1))], readPast)
      )
    ).toEqual([
      ['p1-a', 'p1-b'],
      ['p2-a', 'p2-b'],
    ]);
  });

  it('drops an entry that moved below the loaded rows', () => {
    expect(
      ids(placeWorkFeedPatches(pages, [upsertedPatch(at('p1-a', 10))], more))
    ).toEqual([['p1-b'], ['p2-a', 'p2-b']]);
  });

  it('gives up on an invalidated batch', () => {
    expect(
      placeWorkFeedPatches(
        pages,
        [upsertedPatch(at('new', 45)), invalidatedPatch()],
        more
      )
    ).toBeUndefined();
  });
});

describe('writeWorkFeedPatches', () => {
  const firstPage = { input: { cursor: null } };
  const secondPage = { input: { cursor: 'cursor-2' } };

  it('writes only the cached pages the batch changed', async () => {
    const fake = createFakeWorkFeedClient();
    for (const variables of [firstPage, secondPage]) {
      fake.client.executeQuery({ variables } as never);
    }
    fake.queries[0].resolve(workFeedPage([at('a', 50)], 'cursor-2'));
    fake.queries[1].resolve(workFeedPage([at('b', 30)]));

    const placed = await writeWorkFeedPatches(
      fake.host,
      [firstPage, secondPage],
      [upsertedPatch(at('new', 40))]
    );

    expect(placed).toBe(true);
    // Older than the first page's last row, it belongs to the second page.
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].variables).toEqual(secondPage);
    expect(fake.writes[0].data).toEqual(
      workFeedPage([at('new', 40), at('b', 30)])
    );
  });

  it('writes an entry the last cached page read past into it', async () => {
    const fake = createFakeWorkFeedClient();
    fake.client.executeQuery({ variables: firstPage } as never);
    fake.queries[0].resolve(
      workFeedPage([at('a', 50)], 'cursor-2', {
        sortAt: '2026-02-01T10:05:00Z',
        entityId: 'skipped',
      })
    );

    expect(
      await writeWorkFeedPatches(
        fake.host,
        [firstPage],
        [upsertedPatch(at('gap', 20))]
      )
    ).toBe(true);
    expect(fake.writes[0].data).toEqual(
      workFeedPage([at('a', 50), at('gap', 20)], 'cursor-2', {
        sortAt: '2026-02-01T10:05:00Z',
        entityId: 'skipped',
      })
    );
  });

  it('asks for a read when a page is not cached', async () => {
    const fake = createFakeWorkFeedClient();
    expect(
      await writeWorkFeedPatches(
        fake.host,
        [firstPage],
        [upsertedPatch(at('new', 40))]
      )
    ).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
});
