import { describe, expect, it } from 'vitest';
import {
  ALL_INBOX_ROW_TYPES,
  activeFilterCount,
  clearFor,
  clearIncludes,
  laneOfRowId,
  laneOfVisit,
  parseInboxFilters,
  rowTypesFor,
  serializeInboxFilters,
} from './inbox-filters';

describe('rowTypesFor', () => {
  it('reads every row type until a category is hidden', () => {
    expect(
      rowTypesFor({ lane: 'signal', status: 'all', hiddenCategories: [] })
    ).toEqual(ALL_INBOX_ROW_TYPES);
  });

  it('drops both channel and discussion rows of a hidden category', () => {
    const types = rowTypesFor({
      lane: 'signal',
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
      activeFilterCount({
        lane: 'signal',
        status: 'unread',
        hiddenCategories: ['email'],
      })
    ).toBe(1);
    expect(
      activeFilterCount({
        lane: 'signal',
        status: 'unread',
        hiddenCategories: [],
      })
    ).toBe(0);
  });

  it('keeps only what this build understands', () => {
    expect(
      parseInboxFilters(
        JSON.stringify({
          status: 'unread',
          hiddenCategories: ['email', 'retired-kind'],
        })
      )
    ).toEqual({
      lane: 'signal',
      status: 'unread',
      hiddenCategories: ['email'],
    });
    expect(parseInboxFilters('not json')).toEqual({
      lane: 'signal',
      status: 'all',
      hiddenCategories: [],
    });
    // A read-only filter saved by an earlier build opens at All.
    expect(parseInboxFilters(JSON.stringify({ status: 'read' }))).toEqual({
      lane: 'signal',
      status: 'all',
      hiddenCategories: [],
    });
  });

  it('never keeps the lane, so every visit starts in Signal', () => {
    const saved = serializeInboxFilters({
      lane: 'noise',
      status: 'unread',
      hiddenCategories: ['email'],
    });

    expect(JSON.parse(saved)).toEqual({
      status: 'unread',
      hiddenCategories: ['email'],
    });
    expect(parseInboxFilters(saved).lane).toBe('signal');
    // A lane written by hand is ignored too.
    expect(
      parseInboxFilters(JSON.stringify({ lane: 'noise', status: 'all' })).lane
    ).toBe('signal');
  });
});

describe('laneOfRowId', () => {
  it('reads the lane the server marked in the row id', () => {
    expect(laneOfRowId('channel:abc#noise#top_level')).toBe('noise');
    expect(laneOfRowId('channel:abc#top_level')).toBe('signal');
    expect(laneOfRowId('')).toBe('signal');
  });
});

describe('laneOfVisit', () => {
  it('opens in Signal, or in the lane of the row a link shows', () => {
    expect(laneOfVisit(undefined, '')).toBe('signal');
    expect(laneOfVisit(undefined, 'channel:abc#noise#top_level')).toBe('noise');
  });

  it('keeps the lane the reader chose, whatever row shows', () => {
    // Back from a row opened in Noise: no row shows, the choice remains.
    expect(laneOfVisit('noise', '')).toBe('noise');
    expect(laneOfVisit('signal', 'channel:abc#noise#top_level')).toBe('signal');
  });
});

describe('clearFor', () => {
  const now = new Date(2026, 10, 5, 15, 30);

  it('clears today from local midnight, every kind the filters show', () => {
    const clear = clearFor(
      { kind: 'today' },
      { lane: 'signal', status: 'all', hiddenCategories: ['email'] },
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
      { lane: 'signal', status: 'unread', hiddenCategories: [] },
      now
    );
    expect(clear).toEqual({
      lane: 'signal',
      rowTypes: ALL_INBOX_ROW_TYPES,
      unreadOnly: true,
    });
  });

  it('clears the lane the reader looks at', () => {
    const clear = clearFor(
      { kind: 'category', category: 'messages' },
      { lane: 'noise', status: 'all', hiddenCategories: [] },
      now
    );
    expect(clear).toEqual({
      lane: 'noise',
      rowTypes: ['channel_messages'],
      unreadOnly: false,
    });
  });

  it('clears one kind, and nothing of a kind the filters hide', () => {
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { lane: 'signal', status: 'all', hiddenCategories: [] },
        now
      ).rowTypes
    ).toEqual(['channel_mention', 'discussion_mention']);
    expect(
      clearFor(
        { kind: 'category', category: 'mentions' },
        { lane: 'signal', status: 'all', hiddenCategories: ['mentions'] },
        now
      ).rowTypes
    ).toEqual([]);
  });
});

describe('clearIncludes', () => {
  const clear = {
    lane: 'signal' as const,
    rowTypes: ['email' as const],
    unreadOnly: true,
    since: 1_000,
  };

  it('takes a row only when its kind, read state and time all match', () => {
    expect(
      clearIncludes(clear, { type: 'email', unseen: true, latestAt: 1_000 })
    ).toBe(true);
    expect(
      clearIncludes(clear, { type: 'email', unseen: false, latestAt: 2_000 })
    ).toBe(false);
    expect(
      clearIncludes(clear, { type: 'email', unseen: true, latestAt: 999 })
    ).toBe(false);
    expect(
      clearIncludes(clear, { type: 'task', unseen: true, latestAt: 2_000 })
    ).toBe(false);
  });
});
