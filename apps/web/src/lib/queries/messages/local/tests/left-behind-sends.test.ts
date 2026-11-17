import { ThrownResultError } from '@core/util/result';
import { describe, expect, it, vi } from 'vitest';
import { queueIfAnswering, sendLeftBehindOverRest } from '../left-behind-sends';
import type { UnqueuedSend } from '../unqueued-sends';
import { CHANNEL_ID } from './fixtures';

vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../writes', () => ({ whenOnline: vi.fn() }));
vi.mock('../catch-up', () => ({ refreshChannelViews: vi.fn() }));

const send: UnqueuedSend = {
  channelId: CHANNEL_ID,
  id: 'message-1',
  senderId: 'sender-1',
  message: { content: 'typed before the reload' },
};

it('posts the send under its own id once online, then forgets its note', async () => {
  const order: string[] = [];
  const post = vi.fn(async () => {
    order.push('post');
    return {} as never;
  });
  const refresh = vi.fn();
  const forget = vi.fn();

  await sendLeftBehindOverRest(send, {
    online: async () => {
      order.push('online');
    },
    post,
    forget,
    refresh,
  });

  expect(order).toEqual(['online', 'post']);
  expect(post).toHaveBeenCalledExactlyOnceWith(
    { type: 'channel', id: CHANNEL_ID },
    { content: 'typed before the reload', id: 'message-1', nonce: 'message-1' }
  );
  expect(refresh).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
  expect(forget).toHaveBeenCalledExactlyOnceWith('sender-1', 'message-1');
});

it('keeps the note when the post fails, for the next start', async () => {
  const forget = vi.fn();

  await expect(
    sendLeftBehindOverRest(send, {
      online: async () => {},
      post: vi.fn(async () => {
        throw new Error('server unavailable');
      }),
      forget,
    })
  ).rejects.toThrow('server unavailable');

  expect(forget).not.toHaveBeenCalled();
});

it('forgets a send the server already holds', async () => {
  const forget = vi.fn();

  await sendLeftBehindOverRest(send, {
    online: async () => {},
    post: vi.fn(async () => {
      throw new ThrownResultError([{ code: 'CONFLICT', message: 'stored' }]);
    }),
    forget,
  });

  expect(forget).toHaveBeenCalledExactlyOnceWith('sender-1', 'message-1');
});

describe('queueIfAnswering', () => {
  it('passes on what the queue holds', async () => {
    const mutations = [{ uuid: 'message-1' }] as never;
    const queue = queueIfAnswering({ inspectMutations: async () => mutations });

    await expect(queue.inspectMutations?.()).resolves.toBe(mutations);
  });

  it('takes a queue that fails, is missing or cannot be asked to hold nothing', async () => {
    const failing = queueIfAnswering({
      inspectMutations: async () => {
        throw new Error('Queue inspection is unavailable');
      },
    });

    await expect(failing.inspectMutations?.()).resolves.toEqual([]);
    await expect(
      queueIfAnswering(undefined).inspectMutations?.()
    ).resolves.toEqual([]);
    await expect(queueIfAnswering({}).inspectMutations?.()).resolves.toEqual(
      []
    );
  });

  it('does not wait on a queue that is still starting', async () => {
    const starting = queueIfAnswering(
      { inspectMutations: () => new Promise(() => {}) },
      1
    );

    await expect(starting.inspectMutations?.()).resolves.toEqual([]);
  });
});
