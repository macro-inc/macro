import type { CreatableBlock } from '../types';
import { creatableDescription, creatableId } from './creatable';

/** Lower is better; a term found only in other text scores worst. */
function nameScore(name: string, term: string): number | undefined {
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (name.split(/[\s-]+/).some((word) => word.startsWith(term))) return 2;
  if (name.includes(term)) return 3;
  return undefined;
}

function termScore(
  names: string[],
  otherText: string,
  term: string
): number | undefined {
  const scores = names
    .map((name) => nameScore(name, term))
    .filter((score) => score !== undefined);
  if (scores.length) return Math.min(...scores);
  return otherText.includes(term) ? 4 : undefined;
}

/**
 * The options matching every term, best match first: an option whose name
 * starts with the query beats one that only mentions it in its description.
 * Ties keep the incoming order (recent use).
 */
export function searchLauncherBlocks(
  items: CreatableBlock[],
  query: string
): CreatableBlock[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;

  const scored = items.flatMap((item) => {
    // Translated label plus the English id, so English terms keep matching in
    // every interface language.
    const names = [item.label, creatableId(item)].map((name) =>
      name.toLowerCase()
    );
    const otherText = [
      creatableDescription(item),
      item.launcherHint,
      item.blockName,
      ...(item.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let total = 0;
    for (const term of terms) {
      const score = termScore(names, otherText, term);
      if (score === undefined) return [];
      total += score;
    }
    return [{ item, total }];
  });

  return scored
    .sort((left, right) => left.total - right.total)
    .map(({ item }) => item);
}
