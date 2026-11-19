import { describe, expect, it } from 'vitest';
import {
  ALL_INBOX_ROW_TYPES,
  activeFilterCount,
  clearFor,
  clearIncludes,
  DEFAULT_INBOX_FILTERS,
  INBOX_CATEGORIES,
  parseInboxFilters,
  rowTypesFor,
} from './inbox-filters';
import type { InboxRowType } from './inbox-row';

describe('rowTypesFor', () => {
  it('reads every row type when no category is selected', () => {
    expect(rowTypesFor(DEFAULT_INBOX_FILTERS)).toEqual(ALL_INBOX_ROW_TYPES);
  });

  it('reads both channel and discussion mentions when only Mentions is selected', () => {
    expect(
      rowTypesFor({
        status: 'all',
        selectedCategories: ['mentions'],
      })
    ).toEqual(['channel_mention', 'discussion_mention']);
  });

  it('widens the feed to include each selected category', () => {
    expect(
      rowTypesFor({
        status: 'all',
        selectedCategories: ['mentions', 'calendar'],
      })
    ).toEqual([
      'channel_mention',
      'discussion_mention',
      'calendar_event',
      'calendar_join_request',
    ]);
  });
});

describe('saved filters', () => {
  it('counts selected categories independently of All or Unread', () => {
    expect(activeFilterCount(DEFAULT_INBOX_FILTERS)).toBe(0);
    expect(
      activeFilterCount({ status: 'unread', selectedCategories: [] })
    ).toBe(0);
    expect(
      activeFilterCount({ status: 'unread', selectedCategories: ['email'] })
    ).toBe(1);
    expect(
      activeFilterCount({
        status: 'all',
        selectedCategories: ['mentions', 'calendar'],
      })
    ).toBe(2);
  });

  it('keeps known selections once and discards invalid saved values', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'unread',
          selectedCategories: ['email', 'retired-kind', 'email'],
        })
      )
    ).toEqual({ status: 'unread', selectedCategories: ['email'] });
    for (const raw of [
      null,
      'not json',
      'null',
      '42',
      '{}',
      '{"status":"read"}',
      '{"selectedCategories":false}',
    ]) {
      expect(parseInboxFilters(raw)).toEqual(DEFAULT_INBOX_FILTERS);
    }
  });

  it('migrates nothing hidden to nothing selected', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'unread',
          hiddenCategories: [],
        })
      )
    ).toEqual({ status: 'unread', selectedCategories: [] });
  });

  it('migrates hidden categories without changing which row types are shown', () => {
    const filters = parseInboxFilters(
      JSON.stringify({
        status: 'unread',
        hiddenCategories: ['email', 'calendar', 'email', 'retired-kind'],
      })
    );
    expect(filters).toEqual({
      status: 'unread',
      selectedCategories: [
        'mentions',
        'replies',
        'messages',
        'comments',
        'tasks',
        'pull_requests',
        'access',
        'agents',
      ],
    });
    expect(rowTypesFor(filters)).toEqual([
      'agent',
      'channel_mention',
      'channel_messages',
      'channel_thread',
      'discussion_mention',
      'discussion_messages',
      'discussion_thread',
      'task',
      'pull_request',
      'access_requested',
      'access_granted',
      'access_removed',
    ]);
  });

  it('opens all kinds when the legacy value hides every known category', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'all',
          hiddenCategories: INBOX_CATEGORIES,
        })
      )
    ).toEqual(DEFAULT_INBOX_FILTERS);
  });

  it('ignores unknown hidden kinds instead of selecting every known kind', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          hiddenCategories: ['retired-kind'],
        })
      )
    ).toEqual(DEFAULT_INBOX_FILTERS);
  });

  it('falls back to the legacy filter when the selected field is malformed', () => {
    const filters = parseInboxFilters(
      JSON.stringify({
        status: 'unread',
        selectedCategories: false,
        hiddenCategories: ['email'],
      })
    );
    expect(filters.status).toBe('unread');
    expect(filters.selectedCategories).toHaveLength(9);
    expect(rowTypesFor(filters)).not.toContain('email');
  });

  it('prefers selected categories when both shapes are stored', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'unread',
          selectedCategories: [],
          hiddenCategories: ['email'],
        })
      )
    ).toEqual({ status: 'unread', selectedCategories: [] });
  });
});

describe('clearFor', () => {
  const now = new Date(2026, 10, 5, 15, 30);

  it('clears today from local midnight, every kind the filters show', () => {
    const clear = clearFor(
      { kind: 'today' },
      { status: 'all', selectedCategories: ['replies'] },
      now
    );
    expect(clear.since).toBe(new Date(2026, 10, 5).getTime());
    expect(clear.unreadOnly).toBe(false);
    expect(clear.rowTypes).not.toContain('email');
    expect(clear.rowTypes).toContain('channel_thread');
  });

  it('clears only unread rows under Unread', () => {
    const clear = clearFor(
      { kind: 'all' },
      { status: 'unread', selectedCategories: [] },
      now
    );
    expect(clear).toEqual({ rowTypes: ALL_INBOX_ROW_TYPES, unreadOnly: true });
  });

  it('clears one kind, and nothing of a kind outside the selection', () => {
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { status: 'all', selectedCategories: [] },
        now
      ).rowTypes
    ).toEqual(['channel_mention', 'discussion_mention']);
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { status: 'all', selectedCategories: ['email'] },
        now
      ).rowTypes
    ).toEqual([]);
  });
});

describe('clearIncludes', () => {
  const clear = {
    rowTypes: ['email' as const],
    unreadOnly: true,
    since: 1_000,
  };

  const row = (
    type: InboxRowType | 'other',
    fields: { unseen?: boolean; latestAt?: number } = {},
    alsoListedAs: readonly InboxRowType[] = []
  ) => ({
    type,
    alsoListedAs,
    unseen: fields.unseen ?? true,
    latestAt: fields.latestAt ?? 2_000,
  });

  it('takes a row only when its kind, read state and time all match', () => {
    expect(clearIncludes(clear, row('email', { latestAt: 1_000 }))).toBe(true);
    expect(clearIncludes(clear, row('email', { unseen: false }))).toBe(false);
    expect(clearIncludes(clear, row('email', { latestAt: 999 }))).toBe(false);
    expect(clearIncludes(clear, row('task'))).toBe(false);
  });

  it('takes a row listed under a cleared kind besides its own', () => {
    const mentions = {
      rowTypes: ['channel_mention' as const, 'discussion_mention' as const],
      unreadOnly: false,
    };
    // A thread whose reply mentions you is cleared with the mentions.
    expect(
      clearIncludes(mentions, row('channel_thread', {}, ['channel_mention']))
    ).toBe(true);
    expect(clearIncludes(mentions, row('channel_thread'))).toBe(false);
    // A kind this build doesn't know still clears by the kinds it lists.
    expect(clearIncludes(mentions, row('other', {}, ['channel_mention']))).toBe(
      true
    );
  });
});
