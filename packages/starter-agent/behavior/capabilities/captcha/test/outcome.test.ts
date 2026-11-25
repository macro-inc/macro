import { expect, test } from 'bun:test';
import { bestOutcome } from '../index.ts';

test('a solved attempt stands; otherwise the last attempt says what the page is like now', () => {
  expect(
    bestOutcome([
      { attempt: 1, outcome: { outcome: 'solved', evidence: 'challengeGone' } },
      { attempt: 2, outcome: { outcome: 'noChallenge' } },
    ])
  ).toEqual({ outcome: 'solved', evidence: 'challengeGone' });
  expect(
    bestOutcome([
      { attempt: 1, outcome: { outcome: 'injected' } },
      { attempt: 2, outcome: { outcome: 'ownerDriving' } },
    ])
  ).toEqual({ outcome: 'ownerDriving' });
  expect(bestOutcome([])).toBeUndefined();
});
