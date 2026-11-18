import { expect, test } from 'bun:test';
import type { Macro } from '@macro-inc/sdk';
import { type Message, sdkChat } from '../index.ts';

type Posted = {
  readonly id: string;
  readonly at: string;
  readonly text: string;
};

/**
 * The slice of Macro the incoming source uses: one DM channel, its live
 * events, and its history. `drop` is the stream ending, as a backend restart
 * ends it; history holds what was posted while it was down.
 */
const fakeMacro = () => {
  const history: Posted[] = [];
  let handler: ((event: unknown) => Promise<void>) | undefined;
  let dropped: ((at: Date) => void) | undefined;
  const channel = {
    id: 'dm1',
    name: async () => 'Ada',
    type: async () => 'direct_message',
    messagesAfter: async function* (after: string) {
      // Newest first, as the SDK gives them.
      for (const posted of [...history].reverse())
        if (posted.at > after)
          yield {
            id: posted.id,
            mentions: [],
            content: async () => posted.text,
            createdAt: async () => posted.at,
            author: async () => ({
              id: 'macro|ada@example.com',
              name: async () => 'Ada',
            }),
            toJSON: () => ({
              id: posted.id,
              detail: { thread_id: null, attachments: [] },
            }),
          };
    },
  };
  const macro = {
    users: { me: async () => ({ id: 'macro|agent@example.com' }) },
    events: {
      on: (_name: string, handle: (event: unknown) => Promise<void>) => {
        handler = handle;
      },
      listen: async (options?: { onDrop?: (at: Date) => void }) => {
        dropped = options?.onDrop;
        return () => undefined;
      },
    },
    channels: {
      list: async function* () {
        yield channel;
      },
      byId: () => channel,
    },
  };
  return {
    macro: macro as unknown as Macro,
    post: (posted: Posted) => history.push(posted),
    live: async (posted: Posted) => {
      history.push(posted);
      await handler?.({
        target: { type: 'channel', channel },
        metadata: {
          message_id: posted.id,
          root_id: posted.id,
          thread_id: null,
          sender: 'macro|ada@example.com',
          created_at: posted.at,
          content: posted.text,
          mentions: [],
          attachments: [],
        },
        sender: { name: async () => 'Ada' },
      });
    },
    drop: (at: Date) => dropped?.(at),
  };
};

test('a message posted while the stream was down is caught up from history, once', async () => {
  const backend = fakeMacro();
  const chat = sdkChat({ macro: async () => backend.macro });
  const incoming = chat.incoming[Symbol.asyncIterator]();
  const next = async (): Promise<Message> => (await incoming.next()).value;

  const first = next();
  await Bun.sleep(10);
  await backend.live({ id: 'm1', at: '2026-11-18T17:44:00Z', text: 'hi' });
  expect((await first).text).toBe('hi');

  // The backend restarts: the stream drops, and a DM lands before it is back.
  backend.drop(new Date('2026-11-18T17:45:00Z'));
  backend.post({ id: 'm2', at: '2026-11-18T17:50:08Z', text: 'are you there?' });

  const caught = await Promise.race([
    next(),
    Bun.sleep(5_000).then(() => {
      throw new Error('the message sent during the gap never arrived');
    }),
  ]);
  expect(caught).toMatchObject({
    id: 'm2',
    channelId: 'dm1',
    dm: true,
    text: 'are you there?',
    senderId: 'macro|ada@example.com',
    mine: false,
  });

  // The stream redelivering it, or a second drop, doesn't deliver it again.
  await backend.live({ id: 'm2', at: '2026-11-18T17:50:08Z', text: 'are you there?' });
  backend.drop(new Date('2026-11-18T17:51:00Z'));
  const nothingMore = await Promise.race([
    next().then((message) => message.id),
    Bun.sleep(2_500).then(() => 'nothing'),
  ]);
  expect(nothingMore).toBe('nothing');
}, 15_000);
