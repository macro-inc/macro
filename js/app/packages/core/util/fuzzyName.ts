import fuzzy from 'fuzzy';

export interface FuzzyNameMatchResult {
  nameHighlight: string;
  score: number;
}

/**
 * Performs fuzzy name matching with quality filtering.
 * Returns null if no match or if the match is too scattered.
 */
export function fuzzyNameMatch(
  query: string,
  name: string
): FuzzyNameMatchResult | null {
  const matchResult = fuzzy.match(query, name, {
    pre: '<macro_em>',
    post: '</macro_em>',
  });

  if (!matchResult) return null;

  // Merge adjacent highlight tags
  const mergedHighlight = matchResult.rendered.replace(
    /<\/macro_em><macro_em>/g,
    ''
  );

  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();

  // Always include exact matches, starts-with, or substring matches
  const isGoodMatch =
    nameLower === queryLower ||
    nameLower.startsWith(queryLower) ||
    nameLower.includes(queryLower);

  if (!isGoodMatch) {
    // Count how many separate highlight segments there are
    const highlightSegments = (mergedHighlight.match(/<macro_em>/g) || [])
      .length;

    // Reject if more than 50% of characters are individual segments (too scattered)
    if (highlightSegments > query.length * 0.5) {
      return null;
    }
  }

  return {
    nameHighlight: mergedHighlight,
    score: matchResult.score,
  };
}
