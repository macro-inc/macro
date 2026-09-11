import type { AgentSessionEntity } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessions: () => [] as AgentSessionEntity[],
  refresh: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [], isLoading: () => false }),
  useDmActivityByUserId: () => () => new Map(),
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@queries/channel/channels', () => ({
  useCachedGraphqlChannelsQuery: () => ({ data: [] }),
}));
vi.mock('@queries/channel/graphql', () => ({
  materializeCachedGraphqlChannels: vi.fn(),
}));
vi.mock('@queries/history/graphql', () => ({
  materializeCachedGraphqlHistoryItems: vi.fn(),
}));
vi.mock('@queries/history/history', () => ({
  useHistoryQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@queries/soup/quick-access-crm-companies', () => ({
  useQuickAccessCrmCompaniesQuery: () => ({
    query: { refetch: vi.fn() },
    companies: () => [],
  }),
}));
vi.mock('@queries/soup/quick-access-skills', () => ({
  useQuickAccessSkillsQuery: () => ({
    query: { refetch: vi.fn() },
    skills: () => [],
  }),
}));
vi.mock('@queries/soup/quick-access-snippets', () => ({
  useQuickAccessSnippetsQuery: () => ({
    query: { refetch: vi.fn() },
    snippets: () => [],
  }),
}));
vi.mock('@queries/soup/quick-access-agent-sessions', () => ({
  useQuickAccessAgentSessionsQuery: () => ({
    query: { refetch: mocks.refresh },
    sessions: () => mocks.sessions(),
  }),
}));
vi.mock('@queries/soup/recently-viewed', () => ({
  useRecentlyViewedSoupQuery: () => ({ data: [] }),
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: () => ({ isSuccess: true, data: undefined }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => undefined,
}));

import { createQuickAccessValue } from './QuickAccessSource';

const session: AgentSessionEntity = {
  type: 'agent_session',
  id: 'session',
  name: 'Fix the menu',
  ownerId: 'owner',
  botId: 'bot',
  bot: { id: 'bot', name: 'Cursor' },
  status: 'no_messages',
  updatedAt: '2026-09-11T12:00:00Z',
};

describe('agent sessions in shared Quick Access', () => {
  it('shares discovery, persona search, renames, removals, and refresh across consumers', () => {
    createRoot((dispose) => {
      const [sessions, setSessions] = createSignal<AgentSessionEntity[]>([]);
      mocks.sessions = sessions;
      const source = createQuickAccessValue();
      const all = source.useList();
      const mentions = source.useList({
        buckets: ['agent_session'],
        searchTerm: () => 'Cursor',
      });
      const documents = source.useList('document');
      expect(source.isLoading()).toBe(false);
      expect(all.items()).toEqual([]);
      setSessions([session]);
      expect(mentions.items().map((item) => item.id)).toEqual(['session']);
      expect(all.items()[0]).toBe(mentions.items()[0]);
      expect(source.getById('session')?.data.name).toBe('Fix the menu');
      expect(documents.items()).toEqual([]);
      setSessions([{ ...session, name: 'Renamed session' }]);
      expect(mentions.items()[0].data.name).toBe('Renamed session');
      setSessions([]);
      expect(all.items()).toEqual([]);
      expect(mentions.items()).toEqual([]);
      expect(source.getById('session')).toBeUndefined();
      source.refresh();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      dispose();
    });
  });
});
