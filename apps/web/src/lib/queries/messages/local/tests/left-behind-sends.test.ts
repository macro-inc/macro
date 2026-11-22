import { ThrownResultError } from '@core/util/result';
import { describe, expect, it, vi } from 'vitest';
import {
  changeLeftBehindOverRest,
  queueIfAnswering,
  sendLeftBehindOverRest,
} from '../left-behind-sends';
import type { UnqueuedChange, UnqueuedSend } from '../unqueued-sends';
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

describe('a change left behind', () => {
  const target = {
    senderId: 'sender-1',
    channelId: CHANNEL_ID,
    id: 'message-1',
  };
  const edit: UnqueuedChange = {
    kind: 'edit',
    uuid: 'u1',
    nonce: 'n1',
    ...target,
    content: 'edited before the reload',
    mentions: [],
    removeAttachmentIds: ['a1'],
    addAttachments: [],
  };
  const parent = { type: 'channel', id: CHANNEL_ID };
  const client = () => ({
    patch: vi.fn(async () => ({}) as never),
    delete: vi.fn(async () => ({}) as never),
    react: vi.fn(async () => ({}) as never),
  });
  const online = async () => {};

  it('is made over REST with its nonce, then forgotten', async () => {
    const rest = client();
    const forget = vi.fn();
    const refresh = vi.fn();
    const deps = { online, client: rest, forget, refresh };

    await changeLeftBehindOverRest(edit, deps);
    await changeLeftBehindOverRest(
      { kind: 'delete', uuid: 'u2', nonce: 'n2', ...target },
      deps
    );
    await changeLeftBehindOverRest(
      {
        kind: 'react',
        uuid: 'u3',
        nonce: 'n3',
        ...target,
        emoji: '👍',
        add: false,
      },
      deps
    );

    expect(rest.patch).toHaveBeenCalledExactlyOnceWith(parent, 'message-1', {
      content: 'edited before the reload',
      mentions: [],
      attachments: { type: 'delta', value: { remove: ['a1'], add: [] } },
      nonce: 'n1',
    });
    expect(rest.delete).toHaveBeenCalledExactlyOnceWith(
      parent,
      'message-1',
      'n2'
    );
    expect(rest.react).toHaveBeenCalledExactlyOnceWith(
      parent,
      'message-1',
      '👍',
      false,
      'n3'
    );
    expect(forget.mock.calls).toEqual([
      ['sender-1', 'u1'],
      ['sender-1', 'u2'],
      ['sender-1', 'u3'],
    ]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('is forgotten when the server refuses it, and kept when the request fails', async () => {
    const forget = vi.fn();
    const failing = (code: string) => ({
      ...client(),
      patch: vi.fn(async () => {
        throw new ThrownResultError([{ code, message: code }]);
      }),
    });

    await changeLeftBehindOverRest(edit, {
      online,
      client: failing('NOT_FOUND'),
      forget,
      refresh: vi.fn(),
    });
    expect(forget).toHaveBeenCalledExactlyOnceWith('sender-1', 'u1');

    await expect(
      changeLeftBehindOverRest(edit, {
        online,
        client: failing('NETWORK_ERROR'),
        forget,
      })
    ).rejects.toBeInstanceOf(ThrownResultError);
    expect(forget).toHaveBeenCalledOnce();
  });
});
