import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ query: undefined as unknown }));

// Keep the Soup client (and its socket) out of jsdom; the test drives the query.
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => state.query,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@entity', () => ({
  isChannelThreadEntity: (entity: { type: string }) =>
    entity.type === 'channel_thread',
}));

import { useChannelThreadsQuery } from './channel-threads';

describe('useChannelThreadsQuery', () => {
  it('never shows placeholder threads from the previous conversation', () => {
    const [query, setQuery] = createStore({
      isEnabled: true,
      isLoading: false,
      isPlaceholderData: false,
      data: {
        entities: [{ type: 'channel_thread', id: 'a1', channelId: 'a' }],
      },
    });
    state.query = query;
    createRoot((dispose) => {
      const hook = useChannelThreadsQuery(
        () => 'a',
        () => true
      );
      expect(hook.threads().map((thread) => thread.id)).toEqual(['a1']);

      // Switching keeps the old rows as placeholder data on the REST path.
      setQuery({ isPlaceholderData: true });
      expect(hook.isPending()).toBe(true);
      expect(hook.threads()).toEqual([]);
      dispose();
    });
  });
});
