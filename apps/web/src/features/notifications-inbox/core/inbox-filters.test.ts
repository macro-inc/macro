import { describe, expect, it } from 'vitest';
import {
  ALL_INBOX_ROW_TYPES,
  activeFilterCount,
  parseInboxFilters,
  rowTypesFor,
  statusIncludes,
} from './inbox-filters';

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

describe('statusIncludes', () => {
  it('narrows to unread rows', () => {
    expect(
      [true, false].filter((unseen) => statusIncludes('unread', unseen))
    ).toEqual([true]);
    expect(
      [true, false].filter((unseen) => statusIncludes('all', unseen))
    ).toEqual([true, false]);
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
