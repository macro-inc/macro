import { queryClient } from '@queries/client';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordChannelViewWhenIdle } from './activity';
import { channelKeys } from './keys';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-channel-activity', () => ({
  recordChannelActivity: vi.fn(),
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
  queryClient.setQueryData<ApiActivity[]>(channelKeys.activity.queryKey, [
    activity('a', '2026-01-01T00:00:00Z'),
    activity('c', '2026-01-01T00:00:00Z'),
  ]);

  recordChannelViewWhenIdle('a');
  recordChannelViewWhenIdle('b');
  await flushIdle();

  expect(
    queryClient.getQueryData<ApiActivity[]>(channelKeys.activity.queryKey)
  ).toEqual([
    activity('a', '2026-02-01T00:00:00Z'),
    activity('c', '2026-01-01T00:00:00Z'),
    activity('b', '2026-02-01T00:00:00Z'),
  ]);
});
