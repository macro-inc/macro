import type { CachedGraphqlChannel } from '@queries/channel/graphql';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuickAccessValue } from './QuickAccessSource';

const sources = vi.hoisted(() => ({
  channels: vi.fn<() => ApiChannelWithLatest[]>(),
  cachedChannels: vi.fn<() => CachedGraphqlChannel[]>(),
  search: vi.fn(),
}));

vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({
    channels: sources.channels,
    isLoading: () => false,
  }),
  useDmActivityByUserId: () => () => new Map(),
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@queries/channel/channels', () => ({
  useCachedGraphqlChannelsQuery: () => ({
    get data() {
      return sources.cachedChannels();
    },
    isSuccess: true,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@queries/channel/graphql', () => ({
  materializeCachedGraphqlChannels: async () => [],
}));
vi.mock('@queries/history/graphql', () => ({
  materializeCachedGraphqlHistoryItems: async () => [],
}));
vi.mock('@queries/history/history', () => ({
  useHistoryQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@queries/soup/quick-access-agent-sessions', () => ({
  useQuickAccessAgentSessionsQuery: () => ({ query: {}, sessions: () => [] }),
}));
vi.mock('@queries/soup/quick-access-crm-companies', () => ({
  useQuickAccessCrmCompaniesQuery: () => ({ query: {}, companies: () => [] }),
}));
vi.mock('@queries/soup/quick-access-skills', () => ({
  useQuickAccessSkillsQuery: () => ({ query: {}, skills: () => [] }),
}));
vi.mock('@queries/soup/quick-access-snippets', () => ({
  useQuickAccessSnippetsQuery: () => ({ query: {}, snippets: () => [] }),
}));
vi.mock('@queries/soup/recently-viewed', () => ({
  useRecentlyViewedSoupQuery: () => ({ data: [] }),
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: () => ({ isSuccess: false }),
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => false }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({
    search: sources.search,
    onCacheChanged: () => () => {},
  }),
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));

function serverChannel(id: string, name: string): ApiChannelWithLatest {
  return {
    id,
    name,
    channel_type: 'private',
    owner_id: 'macro|alice@example.com',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    participants: [],
    auto_join_team: false,
    is_participant: true,
  };
}

function cachedChannel(id: string, name: string): CachedGraphqlChannel {
  return {
    id,
    name,
    channelType: 'private',
    ownerId: 'macro|alice@example.com',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    participantIds: [],
  };
}

describe('Quick Access channels with a partial GraphQL cache', () => {
  beforeEach(() => {
    sources.channels.mockReturnValue([]);
    sources.cachedChannels.mockReturnValue([]);
    sources.search.mockResolvedValue({ documents: [], nextCursor: null });
  });

  it('keeps a known server channel searchable when the cache search is empty', async () => {
    sources.channels.mockReturnValue([serverChannel('old', 'bug-reports')]);
    let dispose!: () => void;
    const list = createRoot((cleanup) => {
      dispose = cleanup;
      return createQuickAccessValue().useList({
        buckets: ['channel'],
        searchTerm: () => 'bug-repo',
        enabled: () => true,
      });
    });
    try {
      await vi.waitFor(() => expect(sources.search).toHaveBeenCalled());
      expect(list.items().map((item) => item.searchText)).toEqual([
        'bug-reports',
      ]);
    } finally {
      dispose();
    }
  });

  it('updates an open search when the full server channel list arrives', async () => {
    const [channels, setChannels] = createSignal<ApiChannelWithLatest[]>([]);
    sources.channels.mockImplementation(channels);
    let dispose!: () => void;
    const list = createRoot((cleanup) => {
      dispose = cleanup;
      return createQuickAccessValue().useList({
        buckets: ['channel'],
        searchTerm: () => 'bug-repo',
        enabled: () => true,
      });
    });
    try {
      expect(list.items()).toEqual([]);
      setChannels([serverChannel('old', 'bug-reports')]);
      await vi.waitFor(() =>
        expect(list.items().map((item) => item.id)).toEqual(['old'])
      );
    } finally {
      dispose();
    }
  });

  it('uses cached channel updates once per id while preserving uncached channels', () => {
    sources.channels.mockReturnValue([
      serverChannel('one', 'old name'),
      serverChannel('two', 'uncached'),
    ]);
    sources.cachedChannels.mockReturnValue([
      cachedChannel('one', 'new name'),
      cachedChannel('three', 'cached only'),
    ]);
    createRoot((dispose) => {
      try {
        const list = createQuickAccessValue().useList('channel');
        expect(list.items().map((item) => [item.id, item.searchText])).toEqual([
          ['one', 'new name'],
          ['three', 'cached only'],
          ['two', 'uncached'],
        ]);
      } finally {
        dispose();
      }
    });
  });
});
