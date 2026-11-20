import { describe, expect, test } from 'bun:test';
import type { UnifiedSearchData } from '../../../generated/search/types.gen';
import type {
  ApiChannelListPage,
  ApiChannelWithLatest,
  GetChannelsData,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { ChannelNamespace } from './namespace';

const NIL = '00000000-0000-0000-0000-000000000000';

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

  test('activeSince lists the channels with a message or reply since then, the most recent first', async () => {
    const latest = (created_at: string) => ({
      message_id: 'm',
      content: '',
      created_at,
      mentions: [],
      sender_id: 'macro|user@example.com',
    });
    const quiet = channel('quiet', 'Quiet');
    const replied = {
      ...channel('replied', 'Replied'),
      latest_message: latest('2026-11-19T10:05:00Z'),
    };
    const old = {
      ...channel('old', 'Old'),
      latest_message: latest('2026-11-19T09:00:00Z'),
    };
    const newest = {
      ...channel('newest', 'Newest'),
      latest_message: latest('2026-11-19T11:00:00Z'),
    };
    const client = {
      storage: {
        getChannels: async () => ({
          data: { items: [quiet, replied, old, newest], next_cursor: null },
        }),
      },
    } as unknown as MacroClient;

    const ids = [];
    for await (const active of new ChannelNamespace(client).activeSince(
      '2026-11-19T10:00:00Z',
    ))
      ids.push(active.id);

    expect(ids).toEqual(['newest', 'replied']);
    const first = await Array.fromAsync(
      new ChannelNamespace(client).activeSince('2026-11-19T10:00:00Z', {
        maxItems: 1,
      }),
    );
    expect(first.map(({ id }) => id)).toEqual(['newest']);
  });

  test('activeSince refuses a value that is not an instant', async () => {
    const client = {
      storage: {
        getChannels: async () => ({ data: { items: [], next_cursor: null } }),
      },
    } as unknown as MacroClient;

    expect(() =>
      new ChannelNamespace(client).activeSince('not a time'),
    ).toThrow('not an instant');
  });

  test('name search asks the server for channel names in one request', async () => {
    const listRequests: GetChannelsData['query'][] = [];
    const searchRequests: UnifiedSearchData[] = [];
    const client = {
      storage: {
        getChannels: async (options?: { query?: GetChannelsData['query'] }) => {
          listRequests.push(options?.query);
          return { data: pages[options?.query?.cursor ?? 'first'] };
        },
      },
      search: {
        unifiedSearch: async (options: UnifiedSearchData) => {
          searchRequests.push(options);
          return {
            data: {
              results: [
                {
                  type: 'channel',
                  id: 'channel-3',
                  channel_id: 'channel-3',
                  channel_type: 'public',
                  highlight: { name: 'Design review', content: [] },
                },
              ],
              next_cursor: null,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const ids = [];
    for await (const channel of new ChannelNamespace(client).search('design')) {
      ids.push(channel.id);
    }

    expect(ids).toEqual(['channel-3']);
    expect(listRequests).toEqual([]);
    expect(searchRequests).toHaveLength(1);
    const body = searchRequests[0]?.body;
    expect(body?.query).toBe('design');
    expect(body?.search_on).toBe('name');
    expect(body?.match_type).toBe('partial');
    expect(body?.filters?.channel_filters?.channel_ids ?? []).toEqual([]);
    expect(body?.filters?.document_filters?.document_ids).toEqual([NIL]);
    expect(body?.filters?.email_filters?.email_thread_ids).toEqual([NIL]);
  });

  test('a blank name search lists every channel', async () => {
    const { client, requests } = channelsClient();

    const ids = [];
    for await (const channel of new ChannelNamespace(client).search('  ')) {
      ids.push(channel.id);
    }

    expect(ids).toEqual(['channel-1', 'channel-2', 'channel-3', 'channel-4']);
    expect(requests).toHaveLength(3);
  });

  test('a blank name search keeps the page size it was given', async () => {
    const { client, requests } = channelsClient();

    await Array.fromAsync(
      new ChannelNamespace(client).search('', { pageSize: 2 }),
    );

    expect(requests[0]).toEqual({ limit: 2 });
  });
});
