import uFuzzy from '@leeoniya/ufuzzy';

export interface FuzzyNameMatchResult {
  nameHighlight: string;
  score: number;
}

const uf = new uFuzzy({});

const mark = (part: string, matched: boolean) =>
  matched ? `<macro_em>${part}</macro_em>` : part;

const append = (accum: string, part: string) => accum + part;

export function fuzzyNameMatch(
  query: string,
  name: string
): FuzzyNameMatchResult | null {
  const needle = query;
  const haystack = [name];
  const idxs = uf.filter(haystack, needle);

  if (!idxs || idxs.length === 0) return null;

  const info = uf.info(idxs, haystack, needle);
  const order = uf.sort(info, haystack, needle);

  if (!order || order.length === 0) return null;

  const infoIdx = order[0];
  const ranges = info.ranges[infoIdx];

  if (!ranges) return null;

  const nameHighlight = uFuzzy.highlight(
    haystack[info.idx[infoIdx]],
    ranges,
    mark,
    '',
    append
  );

  return {
    nameHighlight,
    score: info.idx[infoIdx],
  };
}

export function fuzzyFilterByName<T>(
  query: string,
  items: T[],
  extractName: (item: T) => string
): T[] {
  if (!query) return items;

  const haystack = items.map(extractName);
  const idxs = uf.filter(haystack, query);

  if (!idxs || idxs.length === 0) return [];

  const info = uf.info(idxs, haystack, query);
  const order = uf.sort(info, haystack, query);

  if (!order || order.length === 0) return [];

  return order.map((orderIdx) => items[info.idx[orderIdx]]);
}
