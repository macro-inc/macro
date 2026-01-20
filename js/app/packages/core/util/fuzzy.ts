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
 * Highlights matched query terms in a comma-separated text.
 * Query can be space or comma-separated. Each query term is highlighted
 * in the text parts where it matches.
 */
export function highlightCommaSpaceSeparatedMatches(
  query: string,
  text: string
): string {
  if (!query) return text;

  const queryParts = query
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const textParts = text.split(',').map((p) => p.trim());

  const highlightedParts = textParts.map((textPart) => {
    let highlighted = textPart;

    // Try to highlight each query part in this text part
    for (const queryPart of queryParts) {
      const haystack = [textPart];
      const idxs = uf.filter(haystack, queryPart);

      if (idxs && idxs.length > 0) {
        const info = uf.info(idxs, haystack, queryPart);
        if (info.ranges && info.ranges[0]) {
          highlighted = uFuzzy.highlight(
            textPart,
            info.ranges[0],
            mark,
            '',
            append
          );
          break; // Only highlight once per text part
        }
      }
    }

    return highlighted;
  });

  return highlightedParts.join(', ');
}

/**
 * Fuzzy matches items against a query, returning filtered and ranked results with highlighted matches.
 * For channel items (type === 'channel'), supports delimiter-separated matching where query terms
 * separated by spaces or commas can match in any order.
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

  const hasMultipleTerms = /[\s,]/.test(query);
  const channelItems: T[] = [];
  const nonChannelItems: T[] = [];

  // Separate channels from other items if query has multiple terms
  if (hasMultipleTerms) {
    for (const item of items) {
      if ((item as any).type === 'channel') {
        channelItems.push(item);
      } else {
        nonChannelItems.push(item);
      }
    }
  }

  const results: FuzzyNameMatchResultWithItem<T>[] = [];

  // Handle channel items with delimiter-separated matching
  if (hasMultipleTerms && channelItems.length > 0) {
    for (const item of channelItems) {
      const name = extract(item);
      const score = fuzzyScoreCommaSpaceSeparated(query, name);
      if (score >= 0) {
        results.push({
          item,
          nameHighlight: highlightCommaSpaceSeparatedMatches(query, name),
          score: score * 100,
        });
      }
    }
  }

  // Handle non-channel items (or all items if no multiple terms)
  const itemsToSearch = hasMultipleTerms ? nonChannelItems : items;
  const haystack = itemsToSearch.map(extract);
  const idxs = uf.filter(haystack, query);

  if (idxs && idxs.length > 0) {
    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);

    if (order && order.length > 0) {
      order.forEach((orderIdx, position) => {
        const infoIdx = info.idx[orderIdx];
        const ranges = info.ranges[orderIdx];

        const nameHighlight = ranges
          ? uFuzzy.highlight(haystack[infoIdx], ranges, mark, '', append)
          : haystack[infoIdx];

        results.push({
          item: itemsToSearch[infoIdx],
          nameHighlight,
          // Normalize score: position 0 (best match) should get highest score
          // Use 100 - position to put on same scale as channel scores (0-100)
          score: 100 - position,
        });
      });
    }
  }

  // Sort by score (higher is better for both channels and non-channels)
  results.sort((a, b) => b.score - a.score);

  return results;
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
 * Tests if a delimiter-separated query matches against a comma-separated text.
 * Query can be separated by commas or spaces. Text is always comma-separated.
 * Each query part must fuzzy-match at least one text part in any order.
 * e.g., query "nick hutch" or "nick,hutch" matches text "Nick Noble,teo,hutch"
 * e.g., query "jackson jacob" matches text "jacob, jackson kustec, gabriel"
 */
export function fuzzyTestCommaSpaceSeparated(
  query: string,
  text: string
): boolean {
  if (!query) return true;

  const queryParts = query
    .split(/[\s,]+/)
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
 * Calculates a score for delimiter-separated fuzzy matching.
 * Query can be separated by commas or spaces. Text is always comma-separated.
 * Returns the average of best match scores for each query part.
 * Returns -1 if any query part fails to match.
 * e.g., query "nick hutch" or "nick,hutch" matches text "Nick Noble,teo,hutch"
 * e.g., query "jackson jacob" matches text "jacob, jackson kustec, gabriel"
 */
export function fuzzyScoreCommaSpaceSeparated(
  query: string,
  text: string
): number {
  if (!query) return 1;

  const queryParts = query
    .split(/[\s,]+/)
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
