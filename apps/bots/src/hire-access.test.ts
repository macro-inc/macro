import { expect, test } from 'bun:test';
import { type HireAccess, parseHireAccess } from './hire-access';

const denied = {
  status: 'signed-in',
  teamId: 'review-team',
  role: 'owner',
  computerRollout: 'off',
  roster: { status: 'denied' },
  eligibility: 'denied',
  offers: 'unavailable',
  purchaseEnabled: false,
} satisfies HireAccess;

test('denied local eligibility preserves its scoped denial', () => {
  expect(parseHireAccess(denied)).toEqual(denied);
});

test('local eligibility refuses purchase claims and incomplete roster results', () => {
  expect(parseHireAccess({ ...denied, purchaseEnabled: true })).toEqual({
    status: 'unavailable',
  });
  expect(parseHireAccess({ ...denied, roster: { status: 'ready' } })).toEqual({
    status: 'unavailable',
  });
});
