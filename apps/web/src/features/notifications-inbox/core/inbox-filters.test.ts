import { describe, expect, it } from 'vitest';
import {
  ALL_INBOX_ROW_TYPES,
  activeFilterCount,
  clearFor,
  clearIncludes,
  parseInboxFilters,
  rowTypesFor,
} from './inbox-filters';
import type { InboxRowType } from './inbox-row';

describe('rowTypesFor', () => {
  it('reads every row type until a category is hidden', () => {
    expect(rowTypesFor({ status: 'all', hiddenCategories: [] })).toEqual(
      ALL_INBOX_ROW_TYPES
    );
  });

  it('drops both channel and discussion rows of a hidden category', () => {
    const types = rowTypesFor({
      status: 'all',
      hiddenCategories: ['mentions', 'calendar'],
    });
    expect(types).not.toContain('channel_mention');
    expect(types).not.toContain('discussion_mention');
    expect(types).not.toContain('calendar_event');
    expect(types).not.toContain('calendar_join_request');
    expect(types).toContain('channel_thread');
  });
});

describe('saved filters', () => {
  it('counts hidden categories, not the toggle that shows its own state', () => {
    expect(
      activeFilterCount({ status: 'unread', hiddenCategories: ['email'] })
    ).toBe(1);
    expect(activeFilterCount({ status: 'unread', hiddenCategories: [] })).toBe(
      0
    );
  });

  it('keeps only what this build understands', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'unread',
          hiddenCategories: ['email', 'retired-kind'],
        })
      )
    ).toEqual({ status: 'unread', hiddenCategories: ['email'] });
    expect(parseInboxFilters('not json')).toEqual({
      status: 'all',
      hiddenCategories: [],
    });
    // A read-only filter saved by an earlier build opens at All.
    expect(parseInboxFilters(JSON.stringify({ status: 'read' }))).toEqual({
      status: 'all',
      hiddenCategories: [],
    });
  });
});

describe('clearFor', () => {
  const now = new Date(2026, 10, 5, 15, 30);

  it('clears today from local midnight, every kind the filters show', () => {
    const clear = clearFor(
      { kind: 'today' },
      { status: 'all', hiddenCategories: ['email'] },
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
      { status: 'unread', hiddenCategories: [] },
      now
    );
    expect(clear).toEqual({ rowTypes: ALL_INBOX_ROW_TYPES, unreadOnly: true });
  });

  it('clears one kind, and nothing of a kind the filters hide', () => {
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { status: 'all', hiddenCategories: [] },
        now
      ).rowTypes
    ).toEqual(['channel_mention', 'discussion_mention']);
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { status: 'all', hiddenCategories: ['mentions'] },
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
