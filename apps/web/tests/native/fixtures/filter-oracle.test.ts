import { expect, test } from 'bun:test';
import type { EmailTab } from '../../../src/features/email-view/constants';
import { filterCorpus, LINKS, TAGS } from './filter-corpus';
import { ALL_INBOXES, emailMatchesSelection } from './filter-oracle';
import { fixtureId } from './mail';

const corpus = filterCorpus();
const selection = {
  inboxes: [ALL_INBOXES],
  tags: [],
  calendar: [],
  read: [],
  done: [],
};
const matching = (tab: EmailTab, filters: Record<string, string[]> = {}) =>
  corpus
    .filter((row) =>
      emailMatchesSelection(row, tab, { ...selection, ...filters })
    )
    .map((row) => row.id);

test('Favorites honors readable inboxes as well as favorite membership', () => {
  expect(matching('favorites')).toEqual([6, 8, 9, 60].map(fixtureId));
  expect(matching('favorites', { inboxes: [LINKS[1]] })).toEqual([
    fixtureId(60),
  ]);
  expect(matching('favorites', { inboxes: [] })).toEqual([]);
});

test('Favorites composes read, done, calendar and tag selections', () => {
  expect(matching('favorites', { read: ['unread'] })).toEqual(
    [6, 9].map(fixtureId)
  );
  expect(matching('favorites', { done: ['done'] })).toEqual([fixtureId(9)]);
  expect(matching('favorites', { calendar: ['has-calendar-invite'] })).toEqual([
    fixtureId(60),
  ]);
  expect(matching('favorites', { tags: [TAGS[1]] })).toEqual([fixtureId(6)]);
});

test('Archived requires a readable, archived thread and intersects done refinements', () => {
  expect(matching('archived')).toEqual([3, 9].map(fixtureId));
  expect(matching('archived', { done: ['done'] })).toEqual(
    [3, 9].map(fixtureId)
  );
  expect(matching('archived', { done: ['not-done'] })).toEqual([]);
  expect(matching('archived', { inboxes: [LINKS[1]] })).toEqual([]);
});

test('All and Shared retain their distinct inbox and sharing scopes', () => {
  expect(matching('all')).toEqual([3, 4, 6, 8, 9, 10, 12, 60].map(fixtureId));
  expect(matching('shared')).toEqual([60, 71, 72].map(fixtureId));
});

test.each(['scheduled', 'reminders'] as const)(
  'does not pretend the dormant Soup query owns the %s collection',
  (tab) => {
    expect(() => matching(tab)).toThrow(
      'membership is not owned by the Soup query'
    );
  }
);

test('the oracle reads independent fixture facts rather than the wire response', () => {
  const favorite = corpus.find((row) => row.id === fixtureId(6))!;
  expect(
    emailMatchesSelection(
      { ...favorite, api: { ...favorite.api, isFavorited: false } },
      'favorites',
      selection
    )
  ).toBe(true);
});
