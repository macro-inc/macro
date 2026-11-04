import { describe, expect, test } from 'bun:test';
import type {
  ApiChannelListPage,
  ApiChannelWithLatest,
  GetChannelsData,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { ChannelNamespace } from './namespace';

function channel(id: string, name: string | null): ApiChannelWithLatest {
  return {
    id,
    name,
    auto_join_team: false,
    channel_type: 'public',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_participant: true,
    owner_id: 'macro|user@example.com',
    participants: [],
  };
}

const pages: Record<string, ApiChannelListPage> = {
  first: {
    items: [channel('channel-1', 'General'), channel('channel-2', null)],
    next_cursor: 'cursor-2',
  },
  'cursor-2': {
    items: [channel('channel-3', 'Design review')],
    next_cursor: 'cursor-3',
  },
  'cursor-3': {
    items: [channel('channel-4', 'Random')],
    next_cursor: null,
  },
};

function channelsClient() {
  const requests: GetChannelsData['query'][] = [];
  const client = {
    storage: {
      getChannels: async (options?: { query?: GetChannelsData['query'] }) => {
        requests.push(options?.query);
        return { data: pages[options?.query?.cursor ?? 'first'] };
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('ChannelNamespace', () => {
  test('list pages through every cursor and stops at a null cursor', async () => {
    const { client, requests } = channelsClient();

    const ids = [];
    for await (const channel of new ChannelNamespace(client).list()) {
      ids.push(channel.id);
    }

    expect(ids).toEqual(['channel-1', 'channel-2', 'channel-3', 'channel-4']);
    expect(requests).toEqual([
      { limit: 100 },
      { limit: 100, cursor: 'cursor-2' },
      { limit: 100, cursor: 'cursor-3' },
    ]);
  });

  test('name search finds a channel on a later page', async () => {
    const { client, requests } = channelsClient();

    const ids = [];
    for await (const channel of new ChannelNamespace(client).search('design')) {
      ids.push(channel.id);
    }

    expect(ids).toEqual(['channel-3']);
    expect(requests).toEqual([
      { limit: 100 },
      { limit: 100, cursor: 'cursor-2' },
      { limit: 100, cursor: 'cursor-3' },
    ]);
  });
});
