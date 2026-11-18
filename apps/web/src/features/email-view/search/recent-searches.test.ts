import { createRoot } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import {
  addRecentSearch,
  createRecentEmailSearches,
  MAX_RECENT_EMAIL_SEARCHES,
  matchRecentSearches,
} from './recent-searches';

beforeEach(() => localStorage.clear());

it('puts the latest search first without repeating it', () => {
  expect(addRecentSearch(['invoice', 'budget'], ' Budget ')).toEqual([
    'Budget',
    'invoice',
  ]);
  expect(addRecentSearch(['invoice'], '   ')).toEqual(['invoice']);
});

it('keeps only the most recent searches', () => {
  const many = Array.from({ length: 12 }, (_, index) => `query ${index}`);
  const recent = many.reduce<string[]>(addRecentSearch, []);

  expect(recent).toHaveLength(MAX_RECENT_EMAIL_SEARCHES);
  expect(recent[0]).toBe('query 11');
  expect(recent).not.toContain('query 3');
});

it('matches recent searches containing the typed text, except the text itself', () => {
  const recent = ['quarterly budget', 'Budget', 'invoice'];

  expect(matchRecentSearches(recent, '')).toEqual(recent);
  expect(matchRecentSearches(recent, 'budget')).toEqual(['quarterly budget']);
  expect(matchRecentSearches(recent, 'zzz')).toEqual([]);
});

it('keeps each person their own searches across mounts', () => {
  createRoot((dispose) => {
    const first = createRecentEmailSearches(() => 'user-a');
    first.add('budget');
    first.add('invoice');
    expect(first.recent()).toEqual(['invoice', 'budget']);

    expect(createRecentEmailSearches(() => 'user-a').recent()).toEqual([
      'invoice',
      'budget',
    ]);
    expect(createRecentEmailSearches(() => 'user-b').recent()).toEqual([]);
    dispose();
  });
});

it('ignores a stored value it cannot read', () => {
  localStorage.setItem(
    'macro:email:recent-searches:v1:user-a',
    '{"not":"a list"}'
  );

  createRoot((dispose) => {
    expect(createRecentEmailSearches(() => 'user-a').recent()).toEqual([]);
    dispose();
  });
});
