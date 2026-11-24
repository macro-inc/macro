import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithToken, browserZone } = vi.hoisted(() => ({
  fetchWithToken: vi.fn(),
  browserZone: { name: 'America/New_York' },
}));

vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));
vi.mock('@core/util/cron', () => ({
  getDefaultTimezone: () => browserZone.name,
}));

const { searchClient } = await import('./client');

const sentBody = () =>
  JSON.parse(fetchWithToken.mock.calls.at(-1)?.[1]?.body as string);

describe('searchClient.search', () => {
  beforeEach(() => {
    browserZone.name = 'America/New_York';
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

  it('names no zone when the browser cannot tell its own', async () => {
    browserZone.name = 'Etc/Unknown';

    await searchClient.search({
      params: {},
      request: { query: 'after:2026/11/24', match_type: 'partial' },
    });

    expect(sentBody()).not.toHaveProperty('time_zone');
  });
});
