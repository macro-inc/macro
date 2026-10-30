import { expect, it } from 'vitest';
import { mergeGroupInitialPage } from './merge-group-initial-page';

const page = (ids: string[], nextCursor: string | null) => ({
  itemIds: ids,
  nextCursor,
});

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
    page(['z', 'a'], 'c1')
  );

  expect(merged.pages.map((p) => p.itemIds)).toEqual([
    ['z', 'a'],
    ['c', 'd'],
    ['e'],
  ]);
  expect(merged.pageParams).toEqual([null, 'c1', 'c2']);
});

it('starts from the new first page when nothing beyond it was loaded', () => {
  expect(mergeGroupInitialPage(undefined, page(['a'], 'c1'))).toEqual({
    pages: [page(['a'], 'c1')],
    pageParams: [null],
  });
  expect(
    mergeGroupInitialPage(
      { pages: [page(['old'], 'c0')], pageParams: [null] },
      page(['a'], 'c1')
    )
  ).toEqual({ pages: [page(['a'], 'c1')], pageParams: [null] });
});
