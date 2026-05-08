import { describe, expect, test } from 'vitest';
import type {
  DateMentionItem,
  GroupMentionItem,
  MentionItem,
} from '../../../../utils/mentionsUtils';
import { sortMobileMentions } from './mobileSort';

const HOUR = 60 * 60 * 1000;

function userItem(
  id: string,
  name: string,
  viewedAt: Date = new Date()
): MentionItem {
  return {
    kind: 'user',
    bucket: 'person',
    id,
    searchText: name,
    sortTimestamp: viewedAt.getTime(),
    timestamps: { viewedAt, updatedAt: viewedAt },
    data: {
      id,
      name,
      email: `${name}@example.com`,
    } as MentionItem extends { kind: 'user'; data: infer D } ? D : never,
  } as MentionItem;
}

function docItem(
  id: string,
  name: string,
  viewedAt: Date = new Date()
): MentionItem {
  return {
    kind: 'entity',
    bucket: 'document',
    id,
    searchText: name,
    sortTimestamp: viewedAt.getTime(),
    timestamps: { viewedAt, updatedAt: viewedAt },
    data: {
      id,
      name,
      type: 'document',
    } as MentionItem extends { kind: 'entity'; data: infer D } ? D : never,
  } as MentionItem;
}

function channelItem(
  id: string,
  name: string,
  viewedAt: Date = new Date()
): MentionItem {
  return {
    kind: 'entity',
    bucket: 'channel',
    id,
    searchText: name,
    sortTimestamp: viewedAt.getTime(),
    timestamps: { viewedAt, updatedAt: viewedAt },
    data: {
      id,
      name,
      type: 'channel',
    } as MentionItem extends { kind: 'entity'; data: infer D } ? D : never,
  } as MentionItem;
}

function dmItem(
  id: string,
  name: string,
  viewedAt: Date = new Date()
): MentionItem {
  return {
    kind: 'entity',
    bucket: 'dm',
    id,
    searchText: name,
    sortTimestamp: viewedAt.getTime(),
    timestamps: { viewedAt, updatedAt: viewedAt },
    data: {
      id,
      name,
      type: 'channel',
    } as MentionItem extends { kind: 'entity'; data: infer D } ? D : never,
  } as MentionItem;
}

function groupItem(alias: string): GroupMentionItem {
  return {
    kind: 'group',
    id: alias,
    data: { id: alias, groupAlias: alias },
  };
}

function dateItem(id: string, displayText: string): DateMentionItem {
  return {
    kind: 'date',
    id: `date-${id}`,
    data: {
      id,
      displayText,
      date: new Date(),
      type: 'natural',
    },
  };
}

describe('sortMobileMentions', () => {
  test('boosts users above an equally-fresh doc when no query is present', () => {
    const now = new Date();
    const user = userItem('u1', 'Alice', now);
    const doc = docItem('d1', 'Recent Doc', now);

    const result = sortMobileMentions([doc, user], '');

    expect(result[0].id).toBe('u1');
  });

  test('does not pin stale users above much fresher docs', () => {
    const now = new Date();
    const veryStaleUser = userItem(
      'u1',
      'Old User',
      new Date(now.getTime() - 14 * 24 * HOUR)
    );
    const freshDoc = docItem('d1', 'Just Viewed', now);

    const result = sortMobileMentions([veryStaleUser, freshDoc], '');

    expect(result[0].id).toBe('d1');
  });

  test('orders users by freshness within the user kind', () => {
    const now = new Date();
    const olderUser = userItem(
      'u-old',
      'OldUser',
      new Date(now.getTime() - 6 * HOUR)
    );
    const newerUser = userItem('u-new', 'NewUser', now);

    const result = sortMobileMentions([olderUser, newerUser], '');

    expect(result.indexOf(newerUser)).toBeLessThan(result.indexOf(olderUser));
  });

  test('boosts DMs over similarly-fresh channels', () => {
    const now = new Date();
    const dm = dmItem('dm1', 'alice-bob', now);
    const channel = channelItem('c1', 'general', now);

    const result = sortMobileMentions([channel, dm], '');

    expect(result[0].id).toBe('dm1');
  });

  test('with a query, fuzzy match drives ordering across kinds', () => {
    const now = new Date();
    const matchingDoc = docItem('d1', 'project alpha', now);
    const unrelatedUser = userItem('u1', 'Bob', now);

    const result = sortMobileMentions([unrelatedUser, matchingDoc], 'project');

    expect(result[0].id).toBe('d1');
    expect(result.find((i) => i.id === 'u1')).toBeUndefined();
  });

  test('with a query, a matching user still beats a matching doc on equal freshness', () => {
    const now = new Date();
    const matchingUser = userItem('u1', 'project lead', now);
    const matchingDoc = docItem('d1', 'project plan', now);

    const result = sortMobileMentions([matchingDoc, matchingUser], 'project');

    expect(result[0].id).toBe('u1');
  });

  test('typing a name surfaces the user above group DMs that merely contain that name', () => {
    const now = new Date();
    const platyUser = userItem('u1', 'Platymantis lawtoni', now);
    const groupDmA = dmItem(
      'dm1',
      'Platymantis lawtoni, test me name, Gabriel Birman',
      now
    );
    const groupDmB = dmItem(
      'dm2',
      'Platymantis lawtoni, Gabriel Birman, teo+12312312',
      now
    );

    const result = sortMobileMentions([groupDmA, groupDmB, platyUser], 'platy');

    expect(result[0].id).toBe('u1');
  });

  test('penalizes users whose match starts mid-string vs docs that match at start', () => {
    const now = new Date();
    const lateMatchUser = userItem('u1', 'apple.testing@macro.com', now);
    const startMatchDoc = docItem('d1', 'test lexical api', now);

    const result = sortMobileMentions([lateMatchUser, startMatchDoc], 'test');

    expect(result[0].id).toBe('d1');
  });

  test('groups appear when matched by query but stay below users with stronger boost', () => {
    const now = new Date();
    const here = groupItem('here');
    const user = userItem('u1', 'here-user', now);

    const result = sortMobileMentions([here, user], 'here');

    expect(result.indexOf(user)).toBeLessThan(result.indexOf(here));
  });

  test('items with no timestamp (groups, dates) sink without a query', () => {
    const now = new Date();
    const tomorrow = dateItem('tomorrow', 'tomorrow');
    const here = groupItem('here');
    const doc = docItem('d1', 'Doc', now);

    const result = sortMobileMentions([tomorrow, here, doc], '');

    expect(result[0].id).toBe('d1');
  });
});
