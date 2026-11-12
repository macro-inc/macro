import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dssFetch: vi.fn() }));
vi.mock('./client', () => mocks);

import { ThrownResultError } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { entityMessagesClient } from './messages';

const CHANNEL = { type: 'channel' as const, id: 'channel-1' };
const POST = { id: 'm1', nonce: 'm1', content: 'hello', mentions: [] };
const busy = () => err([statusError(503)]);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.dssFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a message write the server is too busy to take', () => {
  it('is sent again after a second and succeeds', async () => {
    mocks.dssFetch
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(ok({ id: 'm1' }));
    const sent = entityMessagesClient.post(CHANNEL, POST);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.dssFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sent).toEqual({ id: 'm1' });
    expect(mocks.dssFetch).toHaveBeenCalledTimes(2);
    // The same id goes out again, so a write that did land is not repeated.
    expect(mocks.dssFetch.mock.calls[1]).toEqual(mocks.dssFetch.mock.calls[0]);
  });

  it('fails after two more refusals', async () => {
    mocks.dssFetch.mockResolvedValue(busy());
    const sent = entityMessagesClient
      .post(CHANNEL, POST)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await sent).toBeInstanceOf(ThrownResultError);
    expect(mocks.dssFetch).toHaveBeenCalledTimes(3);
  });

  it('is not sent again once a later write to the same message has started', async () => {
    mocks.dssFetch
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(ok({ id: 'm1', content: 'second' }));
    const first = entityMessagesClient
      .patch(CHANNEL, 'm1', { content: 'first', mentions: [] })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    const second = entityMessagesClient.patch(CHANNEL, 'm1', {
      content: 'second',
      mentions: [],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await second).toEqual({ id: 'm1', content: 'second' });
    // The refused edit fails as refused; sent again it would land last.
    expect(await first).toBeInstanceOf(ThrownResultError);
    expect(mocks.dssFetch).toHaveBeenCalledTimes(2);
  });

  it('is sent again beside a later write to another message', async () => {
    mocks.dssFetch
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(ok({ id: 'm2' }))
      .mockResolvedValueOnce(ok({ id: 'm1' }));
    const first = entityMessagesClient.patch(CHANNEL, 'm1', {
      content: 'first',
      mentions: [],
    });
    await vi.advanceTimersByTimeAsync(500);
    const other = entityMessagesClient.patch(CHANNEL, 'm2', {
      content: 'other',
      mentions: [],
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await other).toEqual({ id: 'm2' });
    expect(await first).toEqual({ id: 'm1' });
    expect(mocks.dssFetch).toHaveBeenCalledTimes(3);
  });

  it('does not repeat a write that failed another way', async () => {
    mocks.dssFetch.mockResolvedValue(err([statusError(500)]));
    const sent = entityMessagesClient
      .post(CHANNEL, POST)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await sent).toBeInstanceOf(ThrownResultError);
    expect(mocks.dssFetch).toHaveBeenCalledTimes(1);
  });
});
