import { describe, expect, it } from 'vitest';
import { testFacets } from './evaluate';
import type { Facet } from './types';

type Item = { status: 'closed' | 'open' };
const item = (status: Item['status']): Item => ({ status });

const statusFacet = (mode: 'and' | 'or'): Facet<Item, undefined> => ({
  id: 'status',
  mode,
  options: [
    {
      id: 'open',
      predicate: (item) => item.status === 'open',
    },
  ],
});

describe('testFacets', () => {
  it('keeps an item when an OR option is unresolved', () => {
    expect(
      testFacets(
        { status: ['open', 'unresolved'] },
        [statusFacet('or')],
        item('closed'),
        undefined
      )
    ).toBe(true);
  });

  it('still rejects an item when every OR option is known to miss', () => {
    expect(
      testFacets(
        { status: ['open'] },
        [statusFacet('or')],
        item('closed'),
        undefined
      )
    ).toBe(false);
  });

  it('does not let an unresolved AND option hide a known miss', () => {
    expect(
      testFacets(
        { status: ['open', 'unresolved'] },
        [statusFacet('and')],
        item('closed'),
        undefined
      )
    ).toBe(false);
  });
});
