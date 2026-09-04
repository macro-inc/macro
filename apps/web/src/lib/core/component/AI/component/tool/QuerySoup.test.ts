import { describe, expect, it } from 'vitest';
import { collectSoupItems } from './QuerySoupItems';

describe('collectSoupItems', () => {
  it('walks soup and aliases and dedupes by id', () => {
    const items = collectSoupItems({
      soup: {
        items: [
          {
            id: 'doc-1',
            __typename: 'GraphqlSoupDocument',
            displayName: 'Spec',
          },
        ],
        summary: '1 document',
      },
      signal: {
        items: [
          {
            id: 'mail-1',
            __typename: 'GraphqlSoupEmailThread',
            name: 'Hello',
          },
          {
            id: 'doc-1',
            __typename: 'GraphqlSoupDocument',
            displayName: 'Spec again',
          },
        ],
      },
    });

    expect(items.map((item) => item.id)).toEqual(['doc-1', 'mail-1']);
  });

  it('ignores objects without an items array', () => {
    expect(
      collectSoupItems({
        __typename: 'Query',
        soup: { hasMore: false, summary: '0 items' },
      })
    ).toEqual([]);
  });
});
