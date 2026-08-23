import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { afterEach, describe, expect, it } from 'vitest';
import { queryClient } from '../../client';
import { applyChannelActivity } from '../activity';
import { channelKeys } from '../keys';

const activity = (channelId: string, viewedAt: string): ApiActivity => ({
  channel_id: channelId,
  created_at: '2026-08-01T00:00:00Z',
  id: `activity-${channelId}`,
  updated_at: viewedAt,
  user_id: 'user-1',
  viewed_at: viewedAt,
});

const cached = () =>
  queryClient.getQueryData<ApiActivity[]>(channelKeys.activity.queryKey);

afterEach(() => {
  queryClient.clear();
});

describe('applyChannelActivity', () => {
  it('replaces the row for the channel that was marked viewed', () => {
    queryClient.setQueryData(channelKeys.activity.queryKey, [
      activity('a', '2026-08-01T10:00:00Z'),
      activity('b', '2026-08-01T11:00:00Z'),
    ]);

    applyChannelActivity(activity('a', '2026-08-02T09:00:00Z'));

    expect(cached()).toEqual([
      activity('a', '2026-08-02T09:00:00Z'),
      activity('b', '2026-08-01T11:00:00Z'),
    ]);
  });

  it('appends a channel that had no activity row yet', () => {
    queryClient.setQueryData(channelKeys.activity.queryKey, [
      activity('a', '2026-08-01T10:00:00Z'),
    ]);

    applyChannelActivity(activity('new', '2026-08-02T09:00:00Z'));

    expect(cached()).toHaveLength(2);
    expect(cached()?.at(-1)?.channel_id).toBe('new');
  });

  it('leaves an unfetched list alone rather than seeding one row', () => {
    // A single row would otherwise masquerade as the full activity list until
    // something invalidated it.
    applyChannelActivity(activity('a', '2026-08-02T09:00:00Z'));

    expect(cached()).toBeUndefined();
  });

  it('does not mutate the previously cached array', () => {
    const original = [activity('a', '2026-08-01T10:00:00Z')];
    queryClient.setQueryData(channelKeys.activity.queryKey, original);

    applyChannelActivity(activity('a', '2026-08-02T09:00:00Z'));

    expect(original[0]?.viewed_at).toBe('2026-08-01T10:00:00Z');
    expect(cached()).not.toBe(original);
  });
});
