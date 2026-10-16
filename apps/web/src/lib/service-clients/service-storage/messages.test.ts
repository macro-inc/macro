import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dssFetch: vi.fn() }));

vi.mock('./client', () => ({ dssFetch: mocks.dssFetch }));

import { entityMessagesClient } from './messages';

const parent = { type: 'channel', id: 'channel-1' } as const;
const activity = {
  id: 'activity-1',
  actor_id: 'macro|user@example.com',
  occurred_at: '2026-10-07T12:00:00Z',
  action: 'renamed',
  payload: { to: 'Planning' },
};

beforeEach(() => {
  mocks.dssFetch.mockReset();
});

describe('entityMessagesClient.timeline', () => {
  it('reads the server-ordered timeline route', async () => {
    mocks.dssFetch.mockResolvedValueOnce(
      ok({ entries: [], next_cursor: null, previous_cursor: null })
    );

    await entityMessagesClient.timeline(parent, { limit: 50 });

    expect(mocks.dssFetch).toHaveBeenCalledWith(
      `/messages/channel/channel-1/timeline?${new URLSearchParams({
        selection: JSON.stringify({ limit: 50 }),
      })}`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('skips entry kinds a newer server added', async () => {
    const next_cursor = { id: 'poll-1', created_at: '2026-10-07T11:00:00Z' };
    mocks.dssFetch.mockResolvedValueOnce(
      ok({
        entries: [
          { type: 'activity', activity },
          { type: 'poll', poll: { id: 'poll-1' } },
        ],
        next_cursor,
        previous_cursor: null,
      })
    );

    const page = await entityMessagesClient.timeline(parent);

    expect(page.entries).toEqual([{ type: 'activity', activity }]);
    expect(page.next_cursor).toEqual(next_cursor);
  });
});
