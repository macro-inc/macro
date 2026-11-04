import { describe, expect, it, vi } from 'vitest';
import { createPresenceRequestCoalescer } from './presence-request-coalescer';

const presence = (variables = '{}'): RequestInit => ({
  method: 'POST',
  body: `{"operationName":"HomeUnreadPresence","query":"query HomeUnreadPresence { x }","variables":${variables}}`,
});

function harness() {
  let time = 0;
  const waits: { at: number; resolve: () => void }[] = [];
  const coalesce = createPresenceRequestCoalescer(
    2_000,
    () => time,
    (ms) =>
      new Promise<void>((resolve) => {
        waits.push({ at: time + ms, resolve });
      })
  );
  const pending: { init: RequestInit | undefined; resolve: () => void }[] = [];
  const send = vi.fn(
    (init: RequestInit | undefined) =>
      new Promise<Response>((resolve) => {
        pending.push({
          init,
          resolve: () => resolve(new Response(`r${pending.length}`)),
        });
      })
  );
  const advance = async (ms: number) => {
    time += ms;
    for (const wait of waits.splice(0)) {
      if (wait.at <= time) wait.resolve();
      else waits.push(wait);
    }
    await flush();
  };
  return { coalesce, send, pending, advance };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPresenceRequestCoalescer', () => {
  it('runs one request at a time and shares the next among waiting callers', async () => {
    const { coalesce, send, pending, advance } = harness();

    const first = coalesce(presence(), send);
    const joined = [
      coalesce(presence(), send),
      coalesce(presence(), send),
      coalesce(presence(), send),
    ];
    expect(send).toHaveBeenCalledTimes(1);

    pending[0].resolve();
    await expect((await first).text()).resolves.toBe('r1');
    await flush();
    // The next request waits out the interval since the first one started.
    expect(send).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(send).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    const bodies = await Promise.all(
      joined.map(async (response) => (await response).text())
    );
    expect(bodies).toEqual(['r2', 'r2', 'r2']);
  });

  it('sends one request per interval while a tab refetches in a loop', async () => {
    const { coalesce, send, pending, advance } = harness();
    const responses: Promise<Response>[] = [];
    // A tab asking 12 times a second for a minute.
    for (let tick = 0; tick < 720; tick++) {
      responses.push(coalesce(presence(), send));
      await advance(83);
      for (const request of pending) request.resolve();
    }
    await advance(2_000);
    for (const request of pending) request.resolve();
    await Promise.all(responses);
    expect(send.mock.calls.length).toBe(30);
  });

  it('starts at once after a quiet interval', async () => {
    const { coalesce, send, pending, advance } = harness();
    const first = coalesce(presence(), send);
    pending[0].resolve();
    await first;
    await advance(2_000);

    const second = coalesce(presence(), send);
    expect(send).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    await second;
  });

  it('passes other operations and other variables through', async () => {
    const { coalesce, send, pending } = harness();
    const other: RequestInit = {
      body: '{"operationName":"ChannelListSoup","query":"q"}',
    };
    const responses = [
      coalesce(presence('{"a":1}'), send),
      coalesce(presence('{"a":2}'), send),
      coalesce(other, send),
      coalesce(other, send),
    ];
    expect(send).toHaveBeenCalledTimes(4);
    for (const request of pending) request.resolve();
    await Promise.all(responses);
  });

  it('lets a waiting caller abort without cancelling the shared request', async () => {
    const { coalesce, send, pending, advance } = harness();
    const first = coalesce(presence(), send);
    const controller = new AbortController();
    const aborted = coalesce(
      { ...presence(), signal: controller.signal },
      send
    );
    const kept = coalesce(presence(), send);
    controller.abort(new DOMException('aborted', 'AbortError'));
    await expect(aborted).rejects.toThrow('aborted');

    pending[0].resolve();
    await first;
    await advance(2_000);
    expect(pending[1].init?.signal).toBeUndefined();
    pending[1].resolve();
    await expect((await kept).text()).resolves.toBe('r2');
  });
});
