import { expect, it } from 'vitest';
import fixtures from '../../../../../../crates/subsequence_match/src/ranking/fixtures.tsv?raw';
import recipientFixtures from '../../../../../../crates/subsequence_match/src/ranking/recipient-fixtures.tsv?raw';
import { createFreshSearch, NAME_MATCH_RANKING } from './freshSort';
import {
  nameMatchQuality,
  nameMatchRank,
  nameQuery,
  normalizeNameText,
  startsWordsOf,
} from './name-match-score';
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

it('scores text longer than a name as it scores the same words padded short', () => {
  const padded = `${' '.repeat(5_000)}Sam   Lee${' '.repeat(5_000)}`;
  const long = `sam lee ${'x'.repeat(1_200)}`;
  for (let pass = 0; pass < 2; pass++) {
    expect(normalizeNameText(padded.trim())).toBe('sam lee');
    expect(nameMatchRank('Sam Lee', padded)).toBe(2);
    expect(startsWordsOf('Sam Lee', padded)).toBe(true);
    expect(normalizeNameText(long)).toBe(long);
    expect(nameMatchRank(long, long.toUpperCase())).toBe(2);
    expect(nameMatchQuality('Sam Lee', 'Sam Lee', long, 0.5, 0)).toBe(
      undefined
    );
    expect(startsWordsOf(`${long} more`, long)).toBe(true);
  }
});

it('ranks a prepared query as it ranks the text, at every length', () => {
  for (const words of [1, 200, 200_001]) {
    const text = ` Sam\tLEE${' x'.repeat(words)} `;
    const prepared = nameQuery(text);
    expect(prepared.term).toBe(normalizeNameText(text));
    expect(prepared.parts).toEqual(['sam', 'lee', ...Array(words).fill('x')]);
    for (const label of ['Sam Lee', prepared.term, `${prepared.term} more`]) {
      for (const query of [text, prepared]) {
        expect(recipientMatchRank(label, undefined, query)).toBe(
          recipientMatchRank(label, undefined, text)
        );
        expect(nameMatchRank(label, query)).toBe(nameMatchRank(label, text));
        expect(startsWordsOf(label, query)).toBe(startsWordsOf(label, text));
        expect(nameMatchQuality(label, label, query, 0.5, 0.1)).toBe(
          nameMatchQuality(label, label, text, 0.5, 0.1)
        );
      }
    }
    expect(recipientMatchRank(text, undefined, prepared)).toBe(1);
  }
});
