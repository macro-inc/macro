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
  test('places users and groups before other sources with no query', () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 24 * HOUR);

    const alice = userItem('u1', 'Alice', stale);
    const here = groupItem('here');
    const recentDoc = docItem('d1', 'Recent Doc', now);
    const recentChannel = channelItem('c1', 'general', now);

    const result = sortMobileMentions(
      [alice, here],
      [recentDoc, recentChannel],
      ''
    );

    const ids = result.map((item) => item.id);
    expect(ids.indexOf('u1')).toBeLessThan(ids.indexOf('d1'));
    expect(ids.indexOf('here')).toBeLessThan(ids.indexOf('d1'));
    expect(ids.indexOf('u1')).toBeLessThan(ids.indexOf('c1'));
    expect(ids).toHaveLength(4);
  });

  test('keeps users above fresher non-people items even when docs are more recently viewed', () => {
    const now = new Date();
    const veryStale = new Date(now.getTime() - 7 * 24 * HOUR);

    const oldUser = userItem('u1', 'Old User', veryStale);
    const freshDoc = docItem('d1', 'Just Viewed', now);
    const freshChannel = channelItem('c1', 'just-active', now);

    const result = sortMobileMentions([oldUser], [freshDoc, freshChannel], '');

    expect(result[0].id).toBe('u1');
  });

  test('with a query, users matching the query rank above doc/channel matches', () => {
    const now = new Date();
    const olderUser = new Date(now.getTime() - 6 * HOUR);

    const matchingUser = userItem('u1', 'project', olderUser);
    const matchingDoc = docItem('d1', 'project', now);
    const matchingChannel = channelItem('c1', 'project', now);

    const result = sortMobileMentions(
      [matchingUser],
      [matchingDoc, matchingChannel],
      'project'
    );

    expect(result[0].id).toBe('u1');
  });

  test('returns only others when there are no users/groups', () => {
    const doc = docItem('d1', 'Doc');
    const channel = channelItem('c1', 'channel');

    const result = sortMobileMentions([], [doc, channel], '');

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id).sort()).toEqual(['c1', 'd1']);
  });

  test('returns only users/groups when there are no other items', () => {
    const alice = userItem('u1', 'Alice');
    const here = groupItem('here');

    const result = sortMobileMentions([alice, here], [], '');

    expect(result.map((i) => i.id).sort()).toEqual(['here', 'u1']);
  });

  test('orders multiple users by freshness within the people bucket', () => {
    const now = new Date();
    const olderUser = userItem(
      'u-old',
      'OldUser',
      new Date(now.getTime() - 2 * HOUR)
    );
    const newerUser = userItem('u-new', 'NewUser', now);

    const result = sortMobileMentions([olderUser, newerUser], [], '');

    expect(result[0].id).toBe('u-new');
    expect(result[1].id).toBe('u-old');
  });

  test('groups and dates are still pushed below users/groups when present', () => {
    const alice = userItem('u1', 'Alice');
    const tomorrow = dateItem('tomorrow', 'tomorrow');

    const result = sortMobileMentions([alice], [tomorrow], '');

    const ids = result.map((i) => i.id);
    expect(ids.indexOf('u1')).toBeLessThan(ids.indexOf('date-tomorrow'));
  });
});
