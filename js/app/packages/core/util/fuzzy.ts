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

/**
 * Tests if a comma-separated query matches against a comma-separated text.
 * Each query part must fuzzy-match at least one text part.
 * e.g., query "nick,hutch" matches text "Nick Noble,teo,hutch"
 */
export function fuzzyTestCommaSeparated(query: string, text: string): boolean {
  if (!query) return true;

  const queryParts = query
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const textParts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (queryParts.length === 0) return true;
  if (textParts.length === 0) return false;

  // Every query part must match at least one text part
  for (const queryPart of queryParts) {
    let matchFound = false;
    for (const textPart of textParts) {
      if (fuzzyTest(queryPart, textPart)) {
        matchFound = true;
        break;
      }
    }
    if (!matchFound) return false;
  }

  return true;
}

/**
 * Calculates a score for comma-separated fuzzy matching.
 * Returns the average of best match scores for each query part.
 * Returns -1 if any query part fails to match (can be used instead of fuzzyTestCommaSeparated).
 */
export function fuzzyScoreCommaSeparated(query: string, text: string): number {
  if (!query) return 1;

  const queryParts = query
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const textParts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (queryParts.length === 0) return 1;
  if (textParts.length === 0) return -1;

  let totalScore = 0;

  for (const queryPart of queryParts) {
    let bestScore = -1;
    for (const textPart of textParts) {
      // Simple scoring: ratio of query length to text length when it matches
      if (fuzzyTest(queryPart, textPart)) {
        // Score based on how much of the text part the query covers
        const score = queryPart.length / textPart.length;
        bestScore = Math.max(bestScore, Math.min(1, score));
      }
    }
    if (bestScore < 0) return -1;
    totalScore += bestScore;
  }

  return totalScore / queryParts.length;
}
