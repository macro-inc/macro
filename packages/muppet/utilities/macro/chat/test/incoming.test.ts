import { expect, test } from 'bun:test';
import type { Macro } from '@macro-inc/sdk';
import { type Message, sdkChat } from '../index.ts';

type Posted = {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  /** The root it replies to; a root has none. */
  readonly thread?: string;
};

/**
 * The slice of Macro the incoming source uses: DM channels, their live
 * events, and their history. `drop` and `reconnect` are the stream ending
 * and opening again, as a backend restart does; history holds what was
 * posted while it was down. A channel's history can be held at `gate` to
 * keep a catch-up waiting on it.
 */
const fakeMacro = (channelIds: readonly string[] = ['dm1']) => {
  const history = new Map<string, Posted[]>(channelIds.map((id) => [id, []]));
  const gates = new Map<
    string,
    { readonly reached: () => void; readonly open: Promise<void> }
  >();
  let handler: ((event: unknown) => Promise<void>) | undefined;
  let dropped: ((at: Date) => void) | undefined;
  let reconnected: ((at: Date) => void) | undefined;
  const handle = (channelId: string, posted: Posted) => ({
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
      detail: { thread_id: posted.thread ?? null, attachments: [] },
    }),
    thread: () => ({
      replies: async () =>
        (history.get(channelId) ?? [])
          .filter((reply) => reply.thread === posted.id)
          .map((reply) => handle(channelId, reply)),
    }),
  });
  const channel = (id: string) => ({
    id,
    name: async () => 'Ada',
    type: async () => 'direct_message',
    // Roots created or replied to after `after`, newest first, as the SDK
    // gives them.
    messagesAfter: async function* (after: string) {
      const gate = gates.get(id);
      gate?.reached();
      await gate?.open;
      const posted = history.get(id) ?? [];
      const active = (root: Posted) =>
        root.at > after ||
        posted.some((reply) => reply.thread === root.id && reply.at > after);
      for (const root of [...posted].reverse())
        if (root.thread === undefined && active(root)) yield handle(id, root);
    },
  });
  const macro = {
    users: { me: async () => ({ id: 'macro|agent@example.com' }) },
    events: {
      on: (_name: string, handle: (event: unknown) => Promise<void>) => {
        handler = handle;
      },
      listen: async (options?: {
        onDrop?: (at: Date) => void;
        onReconnect?: (at: Date) => void;
      }) => {
        dropped = options?.onDrop;
        reconnected = options?.onReconnect;
        return () => undefined;
      },
    },
    channels: {
      list: async function* () {
        for (const id of channelIds) yield channel(id);
      },
      byId: (id: string) => channel(id),
    },
  };
  return {
    macro: macro as unknown as Macro,
    post: (posted: Posted, channelId = channelIds[0] ?? 'dm1') =>
      history.get(channelId)?.push(posted),
    live: async (posted: Posted, channelId = channelIds[0] ?? 'dm1') => {
      history.get(channelId)?.push(posted);
      await handler?.({
        target: { type: 'channel', channel: channel(channelId) },
        metadata: {
          message_id: posted.id,
          root_id: posted.thread ?? posted.id,
          thread_id: posted.thread ?? null,
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
    reconnect: (at: Date) => reconnected?.(at),
    /** Hold the channel's history until `release`; `reached` resolves once a read waits on it. */
    gate: (channelId: string) => {
      const open = Promise.withResolvers<void>();
      const reached = Promise.withResolvers<void>();
      gates.set(channelId, { reached: reached.resolve, open: open.promise });
      return {
        reached: reached.promise,
        release: () => {
          gates.delete(channelId);
          open.resolve();
        },
      };
    },
  };
};

const listening = (backend: ReturnType<typeof fakeMacro>) => {
  const chat = sdkChat({ macro: async () => backend.macro });
  const incoming = chat.incoming[Symbol.asyncIterator]();
  return async (): Promise<Message> => (await incoming.next()).value;
};

const within = <Value>(
  wait: Promise<Value>,
  ms: number,
  what: string
): Promise<Value> =>
  Promise.race([
    wait,
    Bun.sleep(ms).then(() => {
      throw new Error(what);
    }),
  ]);

const nothingWithin = async (
  next: Promise<Message>,
  ms: number
): Promise<string> =>
  Promise.race([
    next.then((message) => message.id),
    Bun.sleep(ms).then(() => 'nothing'),
  ]);

test('a message posted while the stream was down is caught up from history once it is back, once', async () => {
  const backend = fakeMacro();
  const next = listening(backend);

  const first = next();
  await Bun.sleep(10);
  await backend.live({ id: 'm1', at: '2026-11-18T17:44:00Z', text: 'hi' });
  expect((await first).text).toBe('hi');

  // The backend restarts: the stream drops, and a DM lands before it is back.
  backend.drop(new Date('2026-11-18T17:45:00Z'));
  backend.post({
    id: 'm2',
    at: '2026-11-18T17:50:08Z',
    text: 'are you there?',
  });
  // Nothing is read until the stream is open again: a read before it would
  // miss what is posted between the read and the reconnect.
  const caught = next();
  expect(await nothingWithin(caught, 1_500)).toBe('nothing');

  backend.reconnect(new Date('2026-11-18T17:50:10Z'));
  expect(
    await within(caught, 5_000, 'the message sent during the gap never arrived')
  ).toMatchObject({
    id: 'm2',
    channelId: 'dm1',
    dm: true,
    text: 'are you there?',
    senderId: 'macro|ada@example.com',
    mine: false,
  });

  // The stream redelivering it, or a second drop, doesn't deliver it again.
  await backend.live({
    id: 'm2',
    at: '2026-11-18T17:50:08Z',
    text: 'are you there?',
  });
  backend.drop(new Date('2026-11-18T17:51:00Z'));
  backend.reconnect(new Date('2026-11-18T17:51:02Z'));
  expect(await nothingWithin(next(), 2_500)).toBe('nothing');
}, 15_000);

test('a reply posted in a delivered thread while the stream was down is caught up', async () => {
  const backend = fakeMacro();
  const next = listening(backend);

  const first = next();
  await Bun.sleep(10);
  await backend.live({ id: 'r1', at: '2026-11-18T17:44:00Z', text: 'plan?' });
  expect((await first).id).toBe('r1');

  backend.drop(new Date('2026-11-18T17:45:00Z'));
  backend.post({
    id: 'r1-reply',
    at: '2026-11-18T17:46:00Z',
    text: 'any news?',
    thread: 'r1',
  });
  backend.reconnect(new Date('2026-11-18T17:47:00Z'));

  expect(
    await within(next(), 5_000, 'the reply sent during the gap never arrived')
  ).toMatchObject({ id: 'r1-reply', root: 'r1', thread: 'r1' });
  // Its root, already delivered, isn't delivered again.
  expect(await nothingWithin(next(), 1_500)).toBe('nothing');
}, 15_000);

test('a drop during a catch-up is caught up too, once the stream is back', async () => {
  const backend = fakeMacro(['dm1', 'dm2']);
  const next = listening(backend);

  const first = next();
  await Bun.sleep(10);
  await backend.live({ id: 'a1', at: '2026-11-18T17:44:00Z', text: 'hi' });
  expect((await first).id).toBe('a1');

  // The first catch-up reads dm1, then waits on dm2's history.
  const dm2 = backend.gate('dm2');
  backend.drop(new Date('2026-11-18T17:45:00Z'));
  backend.reconnect(new Date('2026-11-18T17:45:05Z'));
  await within(dm2.reached, 5_000, 'no catch-up reached dm2');
  // It drops again; a DM lands in dm1, already read, before it is back.
  backend.drop(new Date('2026-11-18T17:46:00Z'));
  backend.post({ id: 'a2', at: '2026-11-18T17:46:30Z', text: 'still there?' });
  backend.reconnect(new Date('2026-11-18T17:47:00Z'));
  dm2.release();

  expect(
    (
      await within(
        next(),
        5_000,
        'the message sent during the second gap never arrived'
      )
    ).id
  ).toBe('a2');
}, 15_000);
