import { normalizeNameText, startsWordsOf } from './name-match-score';

/** Same tiers as subsequence_match::ranking::recipient_match_rank. */
export function recipientMatchRank(
  text: string,
  email: string | undefined,
  query: string
): number {
  const term = normalizeNameText(query);
  if (!term) return 0;
  const address = email?.toLowerCase();
  if (address === term) return 3;
  if (address && term.includes('@') && address.startsWith(term)) return 2;
  return startsWordsOf(text, term) ? 1 : 0;
}
