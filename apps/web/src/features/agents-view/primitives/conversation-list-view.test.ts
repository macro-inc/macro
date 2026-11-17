import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createConversationListView } from './conversation-list-view';

describe('createConversationListView', () => {
  it('restores sort and filters while retaining legacy phone grouping', () => {
    const user = `list-view-${Date.now()}`;
    const key = `agents-conversation-list-view-v1:${encodeURIComponent(user)}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        grouping: 'type',
        sort: 'created',
        filters: {
          type: ['code', 'unknown'],
          status: ['waiting'],
          pullRequest: ['none'],
        },
      })
    );
    const view = createRoot(() => createConversationListView(user));
    expect(view.sort()).toBe('created');
    expect(view.grouping()).toBe('type');
    expect(view.filters()).toEqual({
      type: ['code'],
      status: ['waiting'],
      pullRequest: ['none'],
    });
    view.setGrouping('none');
    view.setSort('updated');
    expect(view.grouping()).toBe('none');
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({
      filters: view.filters(),
      sort: 'updated',
      grouping: 'none',
    });
    view.clear();
    expect(view.filters().status).toEqual([]);
    localStorage.removeItem(key);
  });

  it('defaults unknown saved sorts without losing valid filters', () => {
    const user = `list-view-invalid-${Date.now()}`;
    const key = `agents-conversation-list-view-v1:${encodeURIComponent(user)}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        sort: 'broken',
        grouping: 'type',
        filters: { status: ['unread'] },
      })
    );
    const view = createRoot(() => createConversationListView(user));
    expect(view.sort()).toBe('updated');
    expect(view.filters().status).toEqual(['unread']);
    localStorage.removeItem(key);
  });
});
