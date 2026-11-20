import { queryClient } from '@queries/client';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from '../auth/keys';
import { recordChannelViewWhenIdle } from './activity';
import type { DirectoryChannel } from './directory-core';
import { channelKeys } from './keys';
import { directoryChannel } from './tests/directory-channel';
import { channelRecord, fakeChannelCache } from './tests/directory-fixtures';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-channel-activity', () => ({
  recordChannelActivity: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
}));

const recordActivity = vi.mocked(recordChannelActivity);
// Past the idle wait, well short of the query cache's garbage collection.
const flushIdle = () => vi.advanceTimersByTimeAsync(2_000);

function activity(channelId: string, viewedAt: string): ApiActivity {
  return {
    id: `activity-${channelId}`,
    user_id: 'user',
    channel_id: channelId,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: viewedAt,
    viewed_at: viewedAt,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: 'user',
    authenticated: true,
  });
  recordActivity.mockImplementation(async ({ channelId }) =>
    activity(channelId, '2026-02-01T00:00:00Z')
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  queryClient.clear();
});

it('records a view only after the current work yields', async () => {
  recordChannelViewWhenIdle('a');
  expect(recordActivity).not.toHaveBeenCalled();

  await flushIdle();
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith({
    channelId: 'a',
    activityType: 'view',
  });
});

it('sends one request for views of a channel that are still pending', async () => {
  recordChannelViewWhenIdle('a');
  recordChannelViewWhenIdle('b');
  recordChannelViewWhenIdle('a');

  await flushIdle();
  expect(recordActivity.mock.calls.map(([args]) => args.channelId)).toEqual([
    'a',
    'b',
  ]);
});

it('writes the recorded row into the activity list instead of refetching it', async () => {
  queryClient.setQueryData<ApiActivity[]>(
    channelKeys.activity('user').queryKey,
    [
      activity('a', '2026-01-01T00:00:00Z'),
      activity('c', '2026-01-01T00:00:00Z'),
    ]
  );

  recordChannelViewWhenIdle('a');
  recordChannelViewWhenIdle('b');
  await flushIdle();

  expect(
    queryClient.getQueryData<ApiActivity[]>(
      channelKeys.activity('user').queryKey
    )
  ).toEqual([
    activity('a', '2026-02-01T00:00:00Z'),
    activity('c', '2026-01-01T00:00:00Z'),
    activity('b', '2026-02-01T00:00:00Z'),
  ]);
});

it('stamps the recorded view on the directory without the cache', async () => {
  const key = channelKeys.directory('user').queryKey;
  queryClient.setQueryData<DirectoryChannel[]>(key, [
    directoryChannel('a', { viewedAt: '2026-01-01T00:00:00Z' }),
  ]);

  recordChannelViewWhenIdle('a');
  await flushIdle();

  expect(queryClient.getQueryData<DirectoryChannel[]>(key)?.[0]?.viewedAt).toBe(
    '2026-02-01T00:00:00Z'
  );
});

it("stamps the recorded view on the cache's channel record", async () => {
  const cache = fakeChannelCache();
  cache.put(channelRecord('a', { viewedAt: '2026-01-01T00:00:00Z' }));
  const writeQuery = vi.fn(async () => undefined);
  vi.mocked(getGraphqlSoupCacheHost).mockReturnValue({
    ...cache.host,
    disabled: false,
    writeQuery,
  } as unknown as ReturnType<typeof getGraphqlSoupCacheHost>);

  recordChannelViewWhenIdle('a');
  await flushIdle();

  expect(writeQuery).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationName: 'ChannelViewedAtCacheWrite',
      data: {
        soupUpdates: [
          expect.objectContaining({
            item: {
              __typename: 'GraphqlSoupChannel',
              id: 'a',
              viewedAt: '2026-02-01T00:00:00Z',
            },
          }),
        ],
      },
    })
  );
});
