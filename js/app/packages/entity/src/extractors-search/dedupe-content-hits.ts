import type { ContentHitData } from '../types/search';

function normalizeForComparison(content: string): string {
  return content
    .replace(/<\/?macro_em>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Removes content hits whose text is fully contained within another hit's
 * text. Used to avoid showing redundant "show more" expansions where the
 * expanded rows would reveal nothing the user can't already see.
 */
export function dedupeContentHits(hits: ContentHitData[]): ContentHitData[] {
  if (hits.length <= 1) return hits;

  const indexed = hits.map((hit, idx) => ({
    hit,
    idx,
    norm: normalizeForComparison(hit.content),
  }));

  const sorted = [...indexed].sort((a, b) => b.norm.length - a.norm.length);

  const kept: typeof sorted = [];
  for (const entry of sorted) {
    if (!entry.norm) continue;
    const isContained = kept.some((k) => k.norm.includes(entry.norm));
    if (!isContained) kept.push(entry);
  }

  return kept.sort((a, b) => a.idx - b.idx).map((e) => e.hit);
}
