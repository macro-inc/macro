import { expect, it } from 'vitest';
import { mergeGroupInitialPage } from './merge-group-initial-page';

const page = (ids: string[], nextCursor: string | null) => ({
  itemIds: ids,
  nextCursor,
});
const cursorOf = (p: ReturnType<typeof page>) => p.nextCursor;

it('keeps the continuation pages a group already loaded when the parent refetches', () => {
  const merged = mergeGroupInitialPage(
    {
      pages: [
        page(['a', 'b'], 'c1'),
        page(['c', 'd'], 'c2'),
        page(['e'], null),
      ],
      pageParams: [null, 'c1', 'c2'],
    },
    page(['a', 'b'], 'c1'),
    cursorOf
  );

  expect(merged.data.pages.map((p) => p.itemIds)).toEqual([
    ['a', 'b'],
    ['c', 'd'],
    ['e'],
  ]);
  expect(merged.data.pageParams).toEqual([null, 'c1', 'c2']);
  expect(merged.stale).toBe(false);
});

it('flags the kept pages stale when the first page now ends elsewhere', () => {
  const merged = mergeGroupInitialPage(
    {
      pages: [page(['a', 'b'], 'c1'), page(['c', 'd'], null)],
      pageParams: [null, 'c1'],
    },
    page(['z', 'a'], 'cz'),
    cursorOf
  );

  expect(merged.data.pages.map((p) => p.itemIds)).toEqual([
    ['z', 'a'],
    ['c', 'd'],
  ]);
  expect(merged.stale).toBe(true);
});

it('starts from the new first page when nothing beyond it was loaded', () => {
  expect(mergeGroupInitialPage(undefined, page(['a'], 'c1'), cursorOf)).toEqual(
    { data: { pages: [page(['a'], 'c1')], pageParams: [null] }, stale: false }
  );
  expect(
    mergeGroupInitialPage(
      { pages: [page(['old'], 'c0')], pageParams: [null] },
      page(['a'], 'c1'),
      cursorOf
    )
  ).toEqual({
    data: { pages: [page(['a'], 'c1')], pageParams: [null] },
    stale: false,
  });
});
