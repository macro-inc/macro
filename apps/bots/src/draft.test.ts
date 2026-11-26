import { describe, expect, test } from 'bun:test';
import { storeHireDraft, takeHireDraft } from './draft';
import {
  buildSignInUrl,
  fleetIntent,
  hireIntent,
  parseReturnIntent,
  returnPath,
} from './return-intent';

describe('return intents', () => {
  test('round-trips only the local Creator Hire and Fleet destinations', () => {
    for (const intent of [hireIntent, fleetIntent]) {
      const link = new URL(buildSignInUrl(intent), 'http://localhost');
      expect(link.pathname).toBe('/sign-in');
      expect(parseReturnIntent(link.search)).toEqual(intent);
      expect(link.searchParams.get('return')).toBe(returnPath(intent));
    }
  });

  test.each([
    'https://example.com/fleet',
    '//example.com/fleet',
    '/\\example.com/fleet',
    '/creator/../fleet',
    '/%2e%2e/fleet',
    '/fleet#private',
    '/fleet?team=another-team',
    '/passwords',
  ])('rejects %s as a return destination', (target) => {
    expect(
      parseReturnIntent(new URLSearchParams({ return: target }).toString())
    ).toBeUndefined();
  });

  test('rejects duplicate parameters and extras', () => {
    expect(parseReturnIntent('return=%2Ffleet&return=%2F')).toBeUndefined();
    expect(parseReturnIntent('return=%2Ffleet&extra=1')).toBeUndefined();
  });
});

test('a Hire draft stays in its own tab, expires, and can only be consumed once', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const draft = { first: 'Example', last: 'Bot', portrait: 2, width: -5 };
  const handoff = storeHireDraft(storage, draft, 10);
  const otherTab = { ...storage, getItem: () => null };

  expect(takeHireDraft(otherTab, handoff, 11)).toBeUndefined();
  expect(takeHireDraft(storage, crypto.randomUUID(), 11)).toBeUndefined();
  expect(takeHireDraft(storage, handoff, 12)).toEqual(draft);
  expect(takeHireDraft(storage, handoff, 13)).toBeUndefined();

  const expired = storeHireDraft(storage, draft, 20);
  expect(takeHireDraft(storage, expired, 600_020)).toBeUndefined();
  expect(takeHireDraft(storage, expired, 21)).toBeUndefined();
});
