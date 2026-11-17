import type { AgentSessionEntity, ChatEntity } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION_FILTERS } from '../core/conversation-filters';
import { createConversationList } from './conversation-list';

describe('createConversationList', () => {
  it('filters both query partitions, separates waiting, and reacts to sorting', () => {
    const waiting: AgentSessionEntity = {
      type: 'agent_session',
      botId: 'bot',
      id: 'waiting',
      name: 'Waiting',
      ownerId: 'owner',
      status: 'acp_ready',
      turnState: 'blocked',
      createdAt: '2026-03-02',
      updatedAt: '2026-03-06',
    };
    const working: AgentSessionEntity = {
      type: 'agent_session',
      botId: 'bot',
      id: 'working',
      name: 'Working',
      ownerId: 'owner',
      status: 'acp_ready',
      turnState: 'running',
      createdAt: '2026-03-04',
      updatedAt: '2026-03-05',
    };
    const chat: ChatEntity = {
      type: 'chat',
      id: 'chat',
      name: 'Chat',
      ownerId: 'owner',
      createdAt: '2026-03-03',
      updatedAt: '2026-03-07',
    };
    const archived: AgentSessionEntity = {
      ...working,
      id: 'archived',
      archivedBy: 'user',
      createdAt: '2026-03-01',
    };
    createRoot((dispose) => {
      const [sort, setSort] = createSignal<'updated' | 'created'>('updated');
      const [filters, setFilters] = createSignal(EMPTY_CONVERSATION_FILTERS);
      const list = createConversationList({
        conversations: () => [working, waiting, chat],
        archived: () => [archived],
        sort,
        filters,
        factsOf: (item) => ({
          mode: item.type === 'chat' ? 'chat' : 'code',
          state: item.id === 'waiting' ? 'waiting' : 'dormant',
          unread: false,
          pullRequest: null,
        }),
        hasNextPage: () => false,
        loading: () => false,
        loadingNextPage: () => false,
        error: () => false,
        onLoadMore: () => {},
      });
      expect(list.waiting().map((item) => item.id)).toEqual(['waiting']);
      expect(list.conversations().map((item) => item.id)).toEqual([
        'chat',
        'working',
      ]);
      expect(list.archived().map((item) => item.id)).toEqual(['archived']);
      setSort('created');
      expect(list.conversations().map((item) => item.id)).toEqual([
        'working',
        'chat',
      ]);
      setFilters({ type: ['code'], status: [], pullRequest: [] });
      expect(list.conversations().map((item) => item.id)).toEqual(['working']);
      expect(list.waiting().map((item) => item.id)).toEqual(['waiting']);
      dispose();
    });
  });

  it('requests another page when filters leave fewer than twenty rows', () => {
    const state = createRoot((dispose) => {
      const [filters, setFilters] = createSignal(EMPTY_CONVERSATION_FILTERS);
      const rows: ChatEntity[] = Array.from({ length: 21 }, (_, i) => ({
        type: 'chat',
        id: String(i),
        name: String(i),
        ownerId: 'owner',
        createdAt: '2026-03-01',
      }));
      let calls = 0;
      createConversationList({
        conversations: () => rows,
        archived: () => [],
        filters,
        sort: () => 'updated',
        factsOf: () => ({
          mode: 'chat',
          state: 'dormant',
          unread: false,
          pullRequest: null,
        }),
        hasNextPage: () => true,
        loading: () => false,
        loadingNextPage: () => false,
        error: () => false,
        onLoadMore: () => {
          calls++;
        },
      });
      return { dispose, setFilters, calls: () => calls };
    });
    expect(state.calls()).toBe(0);
    state.setFilters({ type: ['code'], status: [], pullRequest: [] });
    expect(state.calls()).toBe(1);
    state.dispose();
  });

  it('fills short filtered lists and guards near-end paging through source state', () => {
    const state = createRoot((dispose) => {
      const [hasNextPage, setHasNextPage] = createSignal(true);
      const [loadingNextPage, setLoadingNextPage] = createSignal(false);
      const [error, setError] = createSignal(false);
      const [fill, setFill] = createSignal<'all' | 'archived'>('all');
      const rows: ChatEntity[] = Array.from({ length: 21 }, (_, i) => ({
        type: 'chat',
        id: String(i),
        name: String(i),
        ownerId: 'owner',
        createdAt: '2026-03-01',
      }));
      let calls = 0;
      const list = createConversationList({
        conversations: () => rows,
        archived: () => [],
        filters: () => EMPTY_CONVERSATION_FILTERS,
        sort: () => 'updated',
        factsOf: () => ({
          mode: 'chat',
          state: 'dormant',
          unread: false,
          pullRequest: null,
        }),
        hasNextPage,
        loading: () => false,
        loadingNextPage,
        error,
        fill,
        onLoadMore: () => {
          calls++;
        },
      });
      return {
        dispose,
        list,
        setFill,
        setLoadingNextPage,
        setError,
        setHasNextPage,
        calls: () => calls,
      };
    });
    const {
      dispose,
      list,
      setFill,
      setLoadingNextPage,
      setError,
      setHasNextPage,
      calls,
    } = state;
    expect(calls()).toBe(0);
    setFill('archived');
    expect(calls()).toBe(1);
    setLoadingNextPage(true);
    list.loadMoreNearEnd({
      scrollTop: 200,
      clientHeight: 200,
      scrollHeight: 500,
    });
    expect(calls()).toBe(1);
    setLoadingNextPage(false);
    setError(true);
    list.loadMoreNearEnd({
      scrollTop: 400,
      clientHeight: 200,
      scrollHeight: 500,
    });
    expect(calls()).toBe(2);
    setHasNextPage(false);
    list.loadMoreNearEnd({
      scrollTop: 400,
      clientHeight: 200,
      scrollHeight: 500,
    });
    expect(calls()).toBe(2);
    dispose();
  });
});
