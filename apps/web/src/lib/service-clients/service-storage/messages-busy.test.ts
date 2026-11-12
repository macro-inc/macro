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
