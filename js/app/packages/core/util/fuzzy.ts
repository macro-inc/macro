import uFuzzy from '@leeoniya/ufuzzy';

export interface FuzzyNameMatchResult {
  nameHighlight: string;
  score: number;
}

export interface FuzzyNameMatchResultWithItem<T> {
  item: T;
  nameHighlight: string;
  score: number;
}

const uf = new uFuzzy({});

const mark = (part: string, matched: boolean) =>
  matched ? `<macro_em>${part}</macro_em>` : part;

const append = (accum: string, part: string) => accum + part;

/**
 * Fuzzy matches items against a query, returning filtered and ranked results with highlighted matches.
 * Returns all items with no highlights if query is empty.
 */
export function fuzzyMatch<T>(
  query: string,
  items: T[],
  extract: (item: T) => string
): FuzzyNameMatchResultWithItem<T>[] {
  if (!query)
    return items.map((item) => ({
      item,
      nameHighlight: extract(item),
      score: 0,
    }));

  const haystack = items.map(extract);
  const idxs = uf.filter(haystack, query);

  if (!idxs || idxs.length === 0) return [];

  const info = uf.info(idxs, haystack, query);
  const order = uf.sort(info, haystack, query);

  if (!order || order.length === 0) return [];

  return order.map((orderIdx) => {
    const infoIdx = info.idx[orderIdx];
    const ranges = info.ranges[orderIdx];

    const nameHighlight = ranges
      ? uFuzzy.highlight(haystack[infoIdx], ranges, mark, '', append)
      : haystack[infoIdx];

    return {
      item: items[infoIdx],
      nameHighlight,
      score: orderIdx,
    };
  });
}

/**
 * Fuzzy filters and ranks items against a query without highlighting.
 * Returns all items if query is empty.
 */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  extract: (item: T) => string
): T[] {
  if (!query) return items;

  const haystack = items.map(extract);
  const idxs = uf.filter(haystack, query);

  if (!idxs || idxs.length === 0) return [];

  const info = uf.info(idxs, haystack, query);
  const order = uf.sort(info, haystack, query);

  if (!order || order.length === 0) return [];

  return order.map((orderIdx) => items[info.idx[orderIdx]]);
}

/**
 * Tests if text matches a fuzzy query.
 * Returns true if query is empty or matches.
 */
export function fuzzyTest(query: string, text: string): boolean {
  if (!query) return true;

  const haystack = [text];
  const idxs = uf.filter(haystack, query);

  return idxs !== null && idxs.length > 0;
}
