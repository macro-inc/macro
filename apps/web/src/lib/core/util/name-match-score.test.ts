import { expect, it } from 'vitest';
import fixtures from '../../../../../../crates/subsequence_match/src/ranking/fixtures.tsv?raw';
import recipientFixtures from '../../../../../../crates/subsequence_match/src/ranking/recipient-fixtures.tsv?raw';
import { createFreshSearch, NAME_MATCH_RANKING } from './freshSort';
import { nameMatchQuality, nameMatchRank } from './name-match-score';
import { recipientMatchRank } from './recipient-match-rank';

it('matches the native per-row relevance fixtures, including UTF-16 positions', () => {
  for (const line of fixtures.trimEnd().split('\n').slice(1)) {
    const [label, text, query, gap, decay, quality, rank] = line.split('\t');
    const actual = nameMatchQuality(
      label,
      text,
      query,
      Number(gap),
      Number(decay)
    );
    if (quality === '-') expect(actual).toBeUndefined();
    else expect(actual).toBeCloseTo(Number(quality), 12);
    expect(nameMatchRank(label, query)).toBe(Number(rank));
  }
});

it('matches native recipient address and word-prefix tiers', () => {
  for (const line of recipientFixtures.trimEnd().split('\n').slice(1)) {
    const [text, email, query, rank] = line.split('\t');
    expect(recipientMatchRank(text, email || undefined, query)).toBe(
      Number(rank)
    );
  }
});

it('keeps an existing row score unchanged when a stronger unrelated match enters the corpus', () => {
  const search = createFreshSearch<{ name: string }>({
    config: { ...NAME_MATCH_RANKING, timeWeight: 0 },
    getName: (item) => item.name,
    getTimestamp: () => ({}),
  });
  const item = { name: 'xxxxxxxx alpha' };
  const alone = search([item], 'alpha')[0];
  const combined = search([item, { name: 'alpha' }], 'alpha').find(
    (row) => row.item === item
  );
  expect(combined?.fuzzyScore).toBe(alone.fuzzyScore);
  expect(combined?.combinedScore).toBe(alone.combinedScore);
  expect(alone.fuzzyScore).toBeLessThan(1);
});
