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
