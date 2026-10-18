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

describe('entityMessagesClient reads', () => {
  const page = { entries: [], next_cursor: null, previous_cursor: null };

  it('bound reads with the caller signal and a deadline', async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    mocks.dssFetch.mockResolvedValue(ok(page));
    const caller = new AbortController();

    await entityMessagesClient.timeline(parent, {}, caller.signal);
    await entityMessagesClient.thread(parent, 'root-1');

    const [timelineInit, threadInit] = mocks.dssFetch.mock.calls.map(
      ([, init]) => init as RequestInit
    );
    caller.abort();
    expect(timelineInit.signal?.aborted).toBe(true);
    expect(threadInit.signal?.aborted).toBe(false);
    deadline.abort();
    expect(threadInit.signal?.aborted).toBe(true);
    timeout.mockRestore();
  });

  it('leave writes to their own delivery semantics', async () => {
    mocks.dssFetch.mockResolvedValueOnce(ok({ id: 'message-1' }));

    await entityMessagesClient.post(parent, { content: 'hi' } as never);

    expect(mocks.dssFetch.mock.calls[0][1]).not.toHaveProperty('signal');
  });

  it('distinguish a rejected cursor from other HTTP failures', async () => {
    mocks.dssFetch.mockResolvedValueOnce(ok(page));
    await entityMessagesClient.timeline(parent);
    const { errorResponseHandler } = mocks.dssFetch.mock.calls[0][1];

    await expect(
      errorResponseHandler(new Response(null, { status: 400 }))
    ).resolves.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      errorResponseHandler(new Response(null, { status: 503 }))
    ).resolves.toMatchObject({ code: 'HTTP_ERROR' });
  });
});
