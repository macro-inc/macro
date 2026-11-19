import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationListView } from './conversation-list-view';

const storage = createUserScopedStorage('agents-conversation-list-view-v1');

describe('createConversationListView', () => {
  afterEach(() => localStorage.clear());

  it('falls back to Status for a saved Type grouping', () => {
    storage.write(
      'user-1',
      JSON.stringify({ grouping: 'type', filters: { type: ['code'] } })
    );
    createRoot((dispose) => {
      const view = createConversationListView('user-1');
      expect(view.grouping()).toBe('status');
      expect(view.filters().type).toEqual(['code']);
      dispose();
    });
  });
});
