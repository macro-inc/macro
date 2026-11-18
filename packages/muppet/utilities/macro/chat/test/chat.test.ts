import { describe, expect, test } from 'bun:test';
import type { WakeContext, Woke } from '../../../../core/agent.ts';
import { behavior } from '../../../../core/behavior.ts';
import { simple } from '../../../../runtimes/simple.ts';
import { scripts } from '../../../../runtimes/test/scripts.ts';
import {
  type Chat,
  chat,
  chatting,
  type Message,
  messagesSince,
  postMessage,
  pushed,
  typing,
  typingIndicators,
} from '../index.ts';

const message = (id: string, text: string): Message => ({
  id,
  channelId: 'c1',
  channel: 'general',
  root: null,
  thread: null,
  dm: false,
  from: 'Ada',
  senderId: 'macro|ada@example.com',
  mine: false,
  at: '2026-11-10T09:00:00Z',
  text,
  mentions: [],
  attachments: [],
});

/** A chat that records what it's asked to do, and delivers `arriving`. */
const fakeChat = (arriving: readonly Message[]) => {
  const did: string[] = [];
  const port: Chat = {
    me: async () => 'macro|agent@example.com',
    channels: async () => [{ id: 'c1', name: 'general' }],
    join: async (channelId) => {
      did.push(`join ${channelId}`);
    },
    leave: async (channelId) => {
      did.push(`leave ${channelId}`);
    },
    send: async (channelId, text) => {
      did.push(`send ${channelId} ${text}`);
      return { channelId, messageId: 'm-sent' };
    },
    dm: async (userId, text) => {
      did.push(`dm ${userId} ${text}`);
      return { channelId: 'dm', messageId: 'm-dm' };
    },
    reply: async (channelId, root, text) => {
      did.push(`reply ${channelId} ${root} ${text}`);
      return { channelId, messageId: 'm-reply' };
    },
    react: async (_, messageId, emoji, on) => {
      did.push(`${on ? 'react' : 'unreact'} ${messageId} ${emoji}`);
    },
    conversation: async () => [],
    since: async () => [
      { id: '1', from: 'Ada', senderId: 'a', at: 't', text: 'one' },
      { id: '2', from: 'Bo', senderId: 'b', at: 't', text: 'two' },
    ],
    email: async () => [],
    typing: async (channelId, action) => {
      did.push(`typing ${channelId} ${action}`);
    },
    incoming: (async function* () {
      yield* arriving;
    })(),
  };
  return { port, did };
};

describe('chat', () => {
  test('delivers messages to handlers, which answer through the chat', async () => {
    const fake = fakeChat([message('m1', 'hello?'), message('m2', 'anyone?')]);
    const woken: string[] = [];

    await behavior()
      .use(chat({ chat: fake.port }))
      .decorate({
        agent: {
          wake: async ({ request }: WakeContext): Promise<Woke> => {
            woken.push(request);
            return { kind: 'done', reply: 'ok' };
          },
        },
      })
      .on(
        (sources) => sources.messages,
        async (incoming, context) => {
          if (incoming.text === 'hello?') {
            context.typing.start(incoming.channelId);
            await postMessage(context, {
              channelId: incoming.channelId,
              text: 'Hi Ada',
            });
          } else await context.wake(`Answer ${incoming.from}`);
        }
      )
      .on(
        (sources) => sources.hooks.failed,
        async () => {}
      )
      .run(simple({ systemPrompt: '', ...scripts() }));

    expect(fake.did).toEqual([
      'typing c1 start',
      'send c1 Hi Ada',
      'typing c1 stop',
    ]);
    expect(woken).toEqual(['Answer Ada']);
  });

  test('lists its functions in the catalog', () => {
    const { capabilities } = chat({ chat: fakeChat([]).port });
    expect(Object.keys(capabilities)).toEqual(['chat']);
    expect(Object.keys(chatting.functions)).toEqual([
      'listChannels',
      'joinChannel',
      'leaveChannel',
      'postMessage',
      'replyInThread',
      'react',
      'dmPerson',
      'readConversation',
      'messagesSince',
      'readEmailThread',
    ]);
  });

  test('refuses an empty message, or a flag sent as one', async () => {
    const fake = fakeChat([]);
    const context = {
      chat: fake.port,
      typing: typing({ send: fake.port.typing }),
    };
    expect(
      postMessage(context, { channelId: 'c1', text: '  ' })
    ).rejects.toThrow('empty message');
    expect(
      postMessage(context, { channelId: 'c1', text: '--help' })
    ).rejects.toThrow('refusing to send a flag as a message');
    expect(fake.did).toEqual([]);
  });

  test("reads one sender's messages since an instant", async () => {
    const fake = fakeChat([]);
    const context = {
      chat: fake.port,
      typing: typing({ send: fake.port.typing }),
    };
    expect(
      await messagesSince(context, {
        channelId: 'c1',
        since: '2026-11-10T00:00:00Z',
        senderId: 'b',
      })
    ).toEqual([{ id: '2', from: 'Bo', senderId: 'b', at: 't', text: 'two' }]);
  });
});

describe('typing', () => {
  test('keeps resending start until stopped, then sends stop once', async () => {
    const sent: string[] = [];
    const { promise: thirdStart, resolve } = Promise.withResolvers<void>();
    const indicator = typing({
      send: async (channelId, action) => {
        sent.push(`${channelId} ${action}`);
        if (sent.filter((line) => line === 'c1 start').length === 3) resolve();
      },
      every: 20,
    });
    indicator.start('c1');
    await thirdStart;
    await indicator.stop('c1');
    await indicator.stop('c1');
    expect(
      sent.filter((line) => line === 'c1 start').length
    ).toBeGreaterThanOrEqual(3);
    expect(sent.filter((line) => line === 'c1 stop')).toEqual(['c1 stop']);
    expect(sent.at(-1)).toBe('c1 stop');
  });

  test('stops by itself after the longest it may type', async () => {
    const sent: string[] = [];
    const { promise: stopped, resolve } = Promise.withResolvers<void>();
    typing({
      send: async (_, action) => {
        sent.push(action);
        if (action === 'stop') resolve();
      },
      every: 1_000,
      most: 30,
    }).start('c1');
    await stopped;
    expect(sent).toEqual(['start', 'stop']);
  });
});

describe('pushed', () => {
  test('starts on first read, and keeps what arrives while the reader is busy', async () => {
    let started = 0;
    let emit: (n: number) => void = () => {};
    const stream = pushed<number>(async (push) => {
      started += 1;
      emit = push;
    });
    expect(started).toBe(0);
    const reader = stream[Symbol.asyncIterator]();
    const first = reader.next();
    await Bun.sleep(0);
    emit(1);
    emit(2);
    emit(3);
    expect(await first).toEqual({ done: false, value: 1 });
    expect(await reader.next()).toEqual({ done: false, value: 2 });
    expect(await reader.next()).toEqual({ done: false, value: 3 });
    expect(started).toBe(1);
  });
});

test('overlapping typing indicators in a channel stop only when the last one does', async () => {
  const sent: string[] = [];
  const indicators = typingIndicators({
    send: async (channelId, action) => {
      sent.push(`${action} ${channelId}`);
    },
    every: 60_000,
    most: 60_000,
  });
  const greeting = indicators.start('dm-1');
  const reply = indicators.start('dm-1');
  expect(sent).toEqual(['start dm-1']);
  await greeting();
  // The reply is still being written: nothing tells Macro to stop.
  expect(sent).toEqual(['start dm-1']);
  await greeting();
  expect(sent).toEqual(['start dm-1']);
  await reply();
  expect(sent).toEqual(['start dm-1', 'stop dm-1']);
  // A new indicator after the last one stopped starts again.
  const again = indicators.start('dm-1');
  expect(sent).toEqual(['start dm-1', 'stop dm-1', 'start dm-1']);
  await again();
});

test('a typing send that fails never throws from start or stop', async () => {
  const indicators = typingIndicators({
    send: async () => {
      throw new Error('Macro is unreachable');
    },
    every: 60_000,
    most: 60_000,
  });
  const stop = indicators.start('dm-1');
  await expect(stop()).resolves.toBeUndefined();
});

test('an indicator in a thread shows there too, and the channel stops only after both', async () => {
  const sent: string[] = [];
  const indicators = typingIndicators({
    send: async (channelId, action, root) => {
      sent.push(
        `${action} ${channelId}${root === undefined ? '' : `/${root}`}`
      );
    },
    every: 60_000,
    most: 60_000,
  });
  const inChannel = indicators.start('c1');
  const inThread = indicators.start('c1', 'r1');
  await inThread();
  // The thread's indicator stopped while the channel's still shows: no stop.
  expect(sent).toEqual(['start c1', 'start c1/r1']);
  await inChannel();
  expect(sent).toEqual(['start c1', 'start c1/r1', 'stop c1']);
});

test("a channel's typing sends go out in order: a stop never overtakes its start", async () => {
  const sent: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const indicators = typingIndicators({
    send: async (channelId, action) => {
      if (action === 'start') await held;
      sent.push(`${action} ${channelId}`);
    },
    every: 60_000,
    most: 60_000,
  });
  const stopping = indicators.start('c1')();
  release();
  await stopping;
  expect(sent).toEqual(['start c1', 'stop c1']);
});

test("chat()'s typing and its typingIndicators are one count per channel", async () => {
  const fake = fakeChat([]);
  const sent = fake.did;
  const { typing: replies, typingIndicators: indicators } = chat({
    chat: fake.port,
  }).decorations;
  const greeting = indicators.start('c1');
  replies.start('c1');
  await replies.stop('c1');
  // The reply's stop leaves the greeting's indicator showing.
  expect(sent).toEqual(['typing c1 start']);
  await greeting();
  expect(sent).toEqual(['typing c1 start', 'typing c1 stop']);
});

test('a slow typing send never builds a backlog: a tick while one is out is skipped', async () => {
  const sent: string[] = [];
  const ticks: (() => void)[] = [];
  let release: () => void = () => {};
  let holding = true;
  const indicators = typingIndicators({
    send: async (channelId, action) => {
      sent.push(`${action} ${channelId}`);
      if (holding)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
    timers: {
      every: (_, run) => {
        ticks.push(run);
        return () => {};
      },
      after: () => () => {},
    },
  });
  const stop = indicators.start('c1');
  // The first start is still out: three ticks add nothing behind it.
  for (const tick of [ticks[0], ticks[0], ticks[0]]) tick?.();
  expect(sent).toEqual(['start c1']);
  holding = false;
  const stopping = stop();
  release();
  await stopping;
  // The stop waited for the one send out, and nothing else.
  expect(sent).toEqual(['start c1', 'stop c1']);
});

test('typing() is typingOn over indicators of its own', async () => {
  const sent: string[] = [];
  const replies = typing({
    send: async (channelId, action) => {
      sent.push(`${action} ${channelId}`);
    },
    every: 60_000,
    most: 60_000,
  });
  replies.start('c1');
  replies.start('c1');
  await replies.stop('c1');
  // Replacing the indicator in the channel never sends a stop in between.
  expect(sent).toEqual(['start c1', 'stop c1']);
});
