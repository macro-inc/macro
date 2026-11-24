import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithToken } = vi.hoisted(() => ({ fetchWithToken: vi.fn() }));

vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));
vi.mock('@core/util/cron', () => ({
  getDefaultTimezone: () => 'America/New_York',
}));

const { searchClient } = await import('./client');

const sentBody = () =>
  JSON.parse(fetchWithToken.mock.calls.at(-1)?.[1]?.body as string);

describe('searchClient.search', () => {
  beforeEach(() => {
    fetchWithToken.mockReset();
    fetchWithToken.mockResolvedValue(ok({ results: [] }));
  });

  it('sends the time zone dates typed into the search are read in', async () => {
    await searchClient.search({
      params: {},
      request: { query: 'after:2026/11/24', match_type: 'partial' },
    });

    expect(sentBody()).toMatchObject({
      query: 'after:2026/11/24',
      time_zone: 'America/New_York',
    });
  });

  it('keeps a time zone the request names', async () => {
    await searchClient.search({
      params: {},
      request: {
        query: 'newer_than:1d',
        match_type: 'partial',
        time_zone: 'Asia/Tokyo',
      },
    });

    expect(sentBody().time_zone).toBe('Asia/Tokyo');
  });
});
