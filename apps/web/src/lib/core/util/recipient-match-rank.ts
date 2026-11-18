import { type NameQuery, nameQuery, startsWordsOf } from './name-match-score';

/** Same tiers as subsequence_match::ranking::recipient_match_rank. A pass
 * over many rows prepares its query once with `nameQuery`. */
export function recipientMatchRank(
  text: string,
  email: string | undefined,
  query: string | NameQuery
): number {
  const prepared = typeof query === 'string' ? nameQuery(query) : query;
  const { term } = prepared;
  if (!term) return 0;
  const address = email?.toLowerCase();
  if (address === term) return 3;
  if (address && term.includes('@') && address.startsWith(term)) return 2;
  return startsWordsOf(text, prepared) ? 1 : 0;
}
