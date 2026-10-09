import { describe, expect, it } from 'vitest';
import {
  type ConversationFacts,
  conversationMatchesFilters,
  EMPTY_CONVERSATION_FILTERS,
  groupConversations,
} from './conversation-filters';

const reviewFix: ConversationFacts = {
  mode: 'code',
  state: 'waiting',
  unread: true,
  pullRequest: 'open',
};
const hiringPlan: ConversationFacts = {
  mode: 'chat',
  state: 'working',
  unread: false,
  pullRequest: null,
};
const kanbanDrag: ConversationFacts = {
  mode: 'code',
  state: 'dormant',
  unread: false,
  pullRequest: null,
};

describe('conversationMatchesFilters', () => {
  it('keeps everything when nothing is selected', () => {
    expect(
      [reviewFix, hiringPlan, kanbanDrag].map((facts) =>
        conversationMatchesFilters(facts, EMPTY_CONVERSATION_FILTERS)
      )
    ).toEqual([true, true, true]);
  });

  it('ORs values inside a category and ANDs across categories', () => {
    const filters = {
      ...EMPTY_CONVERSATION_FILTERS,
      type: ['code' as const],
      status: ['waiting' as const, 'idle' as const],
    };
    expect(conversationMatchesFilters(reviewFix, filters)).toBe(true);
    expect(conversationMatchesFilters(kanbanDrag, filters)).toBe(true);
    expect(conversationMatchesFilters(hiringPlan, filters)).toBe(false);
  });

  it('treats unread as a status a conversation has alongside its turn', () => {
    const filters = {
      ...EMPTY_CONVERSATION_FILTERS,
      status: ['unread' as const],
    };
    expect(conversationMatchesFilters(reviewFix, filters)).toBe(true);
    expect(conversationMatchesFilters(hiringPlan, filters)).toBe(false);
  });

  it('counts a starting session as working', () => {
    const filters = {
      ...EMPTY_CONVERSATION_FILTERS,
      status: ['working' as const],
    };
    expect(
      conversationMatchesFilters({ ...kanbanDrag, state: 'starting' }, filters)
    ).toBe(true);
  });

  it('only offers "no pull request" for code conversations', () => {
    const filters = {
      ...EMPTY_CONVERSATION_FILTERS,
      pullRequest: ['none' as const],
    };
    expect(conversationMatchesFilters(kanbanDrag, filters)).toBe(true);
    expect(conversationMatchesFilters(hiringPlan, filters)).toBe(false);
    expect(conversationMatchesFilters(reviewFix, filters)).toBe(false);
  });
});

describe('groupConversations', () => {
  const items = [
    { id: 'kanban', facts: kanbanDrag },
    { id: 'review', facts: reviewFix },
    { id: 'hiring', facts: hiringPlan },
  ];

  it('returns one unlabeled group when grouping is off', () => {
    expect(groupConversations(items, (item) => item.facts, 'none')).toEqual([
      { id: 'all', label: undefined, items },
    ]);
  });

  it('puts conversations waiting on you first when grouping by status', () => {
    expect(
      groupConversations(items, (item) => item.facts, 'status').map((group) => [
        group.label,
        group.items.map((item) => item.id),
      ])
    ).toEqual([
      ['Needs you', ['review']],
      ['Working', ['hiring']],
      ['Recent', ['kanban']],
    ]);
  });

  it('drops empty groups and keeps the incoming order inside a group', () => {
    expect(
      groupConversations(items, (item) => item.facts, 'type').map((group) => [
        group.label,
        group.items.map((item) => item.id),
      ])
    ).toEqual([
      ['Chat', ['hiring']],
      ['Code', ['kanban', 'review']],
    ]);
  });
});
