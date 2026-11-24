import { queryClient } from '@queries/client';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from '../auth/keys';
import { recordChannelViewWhenIdle } from './activity';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/graphql-channel-activity', () => ({
  recordChannelActivity: vi.fn(),
}));

const recordActivity = vi.mocked(recordChannelActivity);
const directory = { recordView: vi.fn() };
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
  recordChannelViewWhenIdle('a', directory);
  expect(recordActivity).not.toHaveBeenCalled();

  await flushIdle();
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith({
    channelId: 'a',
    activityType: 'view',
  });
});

it('sends one request for views of a channel that are still pending', async () => {
  recordChannelViewWhenIdle('a', directory);
  recordChannelViewWhenIdle('b', directory);
  recordChannelViewWhenIdle('a', directory);

  await flushIdle();
  expect(recordActivity.mock.calls.map(([args]) => args.channelId)).toEqual([
    'a',
    'b',
  ]);
});

it('shows the recorded view on the channel in the directory', async () => {
  recordChannelViewWhenIdle('a', directory);
  await flushIdle();

  expect(directory.recordView).toHaveBeenCalledExactlyOnceWith(
    'a',
    '2026-02-01T00:00:00Z'
  );
});

it('shows nothing when the view was recorded for an account since signed out', async () => {
  recordChannelViewWhenIdle('a', directory);
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: 'someone-else',
    authenticated: true,
  });
  await flushIdle();

  expect(directory.recordView).not.toHaveBeenCalled();
});
