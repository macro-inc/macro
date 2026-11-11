import { normalizeNameText } from './name-match-score';

const WORD_BREAK = /[^\p{Alphabetic}\p{Number}]+/u;

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
  const words = text.toLowerCase().split(WORD_BREAK).filter(Boolean);
  return term
    .split(WORD_BREAK)
    .filter(Boolean)
    .every((part) => words.some((word) => word.startsWith(part)))
    ? 1
    : 0;
}
