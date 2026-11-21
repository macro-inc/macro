import { describe, expect, it, vi } from 'vitest';
import {
  type FetchChannelListIds,
  loadPrewarmChannelIds,
  PREWARM_RECENT_CHANNELS,
  PREWARM_UNREAD_CHANNELS,
} from '../prewarm-list';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

describe('loadPrewarmChannelIds', () => {
  it('asks the server for forty unread channels, then the twenty most recently used', async () => {
    const fetchIds = vi.fn<FetchChannelListIds>(async (list) =>
      list.params.sort_method === 'updated_at'
        ? ['unread-1', 'unread-2', 'both']
        : ['both', 'recent-1']
    );
    expect(await loadPrewarmChannelIds(fetchIds)).toEqual([
      'unread-1',
      'unread-2',
      'both',
      'recent-1',
    ]);
    expect(fetchIds.mock.calls.map(([list]) => list.params)).toEqual([
      { limit: PREWARM_UNREAD_CHANNELS, sort_method: 'updated_at' },
      { limit: PREWARM_RECENT_CHANNELS, sort_method: 'viewed_at' },
    ]);
    expect(PREWARM_UNREAD_CHANNELS).toBe(40);
    expect(PREWARM_RECENT_CHANNELS).toBe(20);
  });
});
