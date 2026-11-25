import { describe, expect, it } from 'vitest';
import type { Recipient } from './recipients';
import {
  searchDraftText,
  searchNeedsWord,
  unresolvedSearchPeople,
} from './search';

const JULIA: Recipient = {
  id: 'macro|julia@example.com',
  label: 'Julia Jones',
  email: 'julia@example.com',
  kind: 'user',
};
const SALES: Recipient = {
  id: 'sales-channel',
  label: 'sales',
  kind: 'channel',
};

const lookups = {
  people: [JULIA],
  channels: [SALES],
  inboxes: [],
  names: {
    userId: 'macro|viewer@example.com',
    tag: () => undefined,
    channel: (id: string) => (id === SALES.id ? SALES.label : undefined),
    inbox: () => undefined,
  },
};

const filters = (value: object) =>
  JSON.stringify({
    type: 'channels',
    channels: { in: [], from: [] },
    ...value,
  });

describe('searchDraftText', () => {
  it('writes the extracted filters as operators before the words', () => {
    const draft = searchDraftText(
      {
        query: 'budget',
        searchFilters: filters({
          channels: { in: ['sales'], from: ['Julia Jones'] },
        }),
        searchBindings: '',
      },
      lookups
    );
    expect(draft.text).toBe(
      'type:channel in:#sales from:julia@example.com budget'
    );
    // The channel stays bound to the id picked.
    expect(draft.bindings).toEqual([
      { token: 'in:#sales', channelIds: ['sales-channel'] },
    ]);
    expect(draft.unresolved).toEqual([]);
  });

  it('writes a name no one was matched to as typed, binding nothing to it', () => {
    const draft = searchDraftText(
      {
        query: 'budget',
        searchFilters: filters({
          channels: { in: ['launch'], from: ['Pat', 'Pat Lee'] },
        }),
        searchBindings: '',
      },
      lookups
    );
    // A spaced name is quoted, so an edit still reads it as one name.
    expect(draft.text).toBe(
      'type:channel in:#launch from:Pat OR from:"Pat Lee" budget'
    );
    expect(draft.bindings).toEqual([]);
    expect(draft.unresolved).toEqual(['launch', 'Pat', 'Pat Lee']);
    expect(unresolvedSearchPeople(draft.text)).toEqual(['Pat', 'Pat Lee']);
  });

  it('reads an edited field as the whole search, with the bindings it kept', () => {
    const draft = searchDraftText(
      {
        query: 'in:#sales budget plan',
        searchFilters: '',
        searchBindings: JSON.stringify([
          { token: 'in:#sales', channelIds: ['sales-channel'] },
        ]),
      },
      lookups
    );
    expect(draft).toEqual({
      text: 'in:#sales budget plan',
      bindings: [{ token: 'in:#sales', channelIds: ['sales-channel'] }],
      unresolved: [],
    });
  });
});

describe('unresolvedSearchPeople', () => {
  it('finds names where an address is needed', () => {
    expect(unresolvedSearchPeople('type:channel from:pat budget')).toEqual([
      'pat',
    ]);
    expect(unresolvedSearchPeople('assignee:pat author:"Pat Lee"')).toEqual([
      'pat',
      'Pat Lee',
    ]);
    // Mail's from: takes a name; me and addresses name someone.
    expect(unresolvedSearchPeople('from:pat budget')).toEqual([]);
    expect(unresolvedSearchPeople('in:#sales from:pat')).toEqual([]);
    // A half-typed address names no one yet.
    expect(unresolvedSearchPeople('type:task assignee:pat@ budget')).toEqual([
      'pat@',
    ]);
    expect(
      unresolvedSearchPeople('type:channel from:me assignee:ana@example.com')
    ).toEqual([]);
  });
});

describe('searchNeedsWord', () => {
  it('holds a sender alone, which the feed cannot check', () => {
    expect(searchNeedsWord('type:channel from:julia@example.com')).toBe(true);
    expect(searchNeedsWord('type:channel from:julia@example.com budget')).toBe(
      false
    );
    expect(searchNeedsWord('type:call from:me')).toBe(true);
    expect(searchNeedsWord('type:task assignee:me')).toBe(false);
  });
});
