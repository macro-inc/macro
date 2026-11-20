import { expect, test } from 'bun:test';
import type { Macro } from '@macro-inc/sdk';
import type { Incoming } from '../entry.ts';
import { type StreamCursor, sdkChat } from '../macro.ts';

type Posted = {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  /** The root it replies to; a root has none. */
  readonly thread?: string;
  /** Deleted, but still listed for its replies. */
  readonly deleted?: boolean;
};

type ListenOptions = {
  readonly resume?: { readonly lastEventId?: string };
  readonly onEventId?: (id: string) => void;
  readonly onDrop?: (at: Date) => void;
  readonly onOpen?: (at: Date) => void;
};

const now = new Date('2026-11-19T12:00:00Z');

/**
 * The slice of Macro the incoming stream uses: one DM, its live events and
 * its history, and the stream's options so a test can open, drop and reopen
 * it, and hand it event ids.
 */
const fakeMacro = () => {
  const posted: Posted[] = [];
  const activeSince: string[] = [];
  let meCalls = 0;
  let meFailures = 0;
  let unreadable = false;
  let failures = 0;
  let broken = false;
  // A channel the backend always fails, listed first.
  const brokenChannel = {
    id: 'broken',
    name: async () => 'Broken',
    type: async () => 'public',
    messagesAfter: (_after: string): AsyncIterable<never> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          reads += 1;
          throw Object.assign(new Error('cannot serialize'), { status: 500 });
        },
      }),
    }),
  };
  let reads = 0;
  let held: Promise<void> | undefined;
  let handler: ((event: unknown) => Promise<void>) | undefined;
  let options: ListenOptions | undefined;
  const handle = (message: Posted) => ({
    id: message.id,
    mentions: [],
    content: async () => message.text,
    createdAt: async () => message.at,
    author: async () => ({
      id: 'macro|ada@example.com',
      name: async () => 'Ada',
    }),
    toJSON: () => ({
      id: message.id,
      detail: {
        thread_id: message.thread ?? null,
        attachments: [],
        deleted_at: message.deleted ? '2026-11-19T11:59:45Z' : null,
      },
    }),
    thread: () => ({
      replies: async () =>
        posted
          .filter((reply) => reply.thread === message.id)
          .map((reply) => handle(reply)),
    }),
  });
  const channel = {
    id: 'dm1',
    name: async () => 'Ada',
    type: async () => 'direct_message',
    // Roots posted or replied to after `after`, newest first, as the SDK
    // gives them.
    messagesAfter: async function* (after: string) {
      // As the SDK's API errors carry it: a 403 for access lost, a 500 for
      // a backend still coming back.
      if (unreadable)
        throw Object.assign(new Error('no access'), { status: 403 });
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('try again'), { status: 500 });
      }
      const active = (root: Posted) =>
        root.at > after ||
        posted.some((reply) => reply.thread === root.id && reply.at > after);
      for (const root of [...posted].reverse())
        if (root.thread === undefined && active(root)) yield handle(root);
    },
  };
  const macro = {
    users: {
      me: async () => {
        meCalls += 1;
        if (meFailures > 0) {
          meFailures -= 1;
          throw new Error('Macro is restarting');
        }
        return { id: 'macro|agent@example.com' };
      },
    },
    events: {
      on: (_name: string, on: (event: unknown) => Promise<void>) => {
        handler = on;
      },
      listen: async (given: ListenOptions) => {
        options = given;
        return () => undefined;
      },
    },
    channels: {
      activeSince: async function* (after: string | Date) {
        activeSince.push(new Date(after).toISOString());
        await held;
        if (broken) yield brokenChannel;
        yield channel;
      },
      byId: () => channel,
    },
  };
  return {
    macro: macro as unknown as Macro,
    activeSince,
    meCalls: () => meCalls,
    /** Listing active channels waits until the returned release. */
    hold: () => {
      const gate = Promise.withResolvers<void>();
      held = gate.promise;
      return () => {
        held = undefined;
        gate.resolve();
      };
    },
    /** The next `times` round trips fail. */
    failMe: (times: number) => {
      meFailures = times;
    },
    options: () => options,
    post: (message: Posted) => posted.push(message),
    /** The DM's history can't be read, as one the agent lost access to. */
    /** A channel the backend always fails is active too; how often it was read. */
    breakChannel: () => {
      broken = true;
    },
    brokenReads: () => reads,
    /** Reading history fails this many more times, as a backend coming back does. */
    failReads: (times: number) => {
      failures = times;
    },
    unreadable: (yes: boolean) => {
      unreadable = yes;
    },
    live: async (message: Posted) => {
      posted.push(message);
      await handler?.({
        target: { type: 'channel', channel },
        metadata: {
          message_id: message.id,
          root_id: message.thread ?? message.id,
          thread_id: message.thread ?? null,
          sender: 'macro|ada@example.com',
          created_at: message.at,
          content: message.text,
          mentions: [],
          attachments: [],
        },
        sender: { name: async () => 'Ada' },
      });
    },
  };
};

const listening = (
  backend: ReturnType<typeof fakeMacro>,
  stored: StreamCursor | undefined | 'unreadable',
  spans: Record<string, unknown>[] = []
) => {
  const written: StreamCursor[] = [];
  const chat = sdkChat({
    macro: async () => backend.macro,
    myName: 'Pip',
    trace: async (_name, run) => {
      const attributes: Record<string, unknown> = {};
      spans.push(attributes);
      return run({
        set: (key, value) => {
          attributes[key] = value;
        },
        traceparent: () => undefined,
      });
    },
    cursor: {
      read: async () => {
        if (stored === 'unreadable') throw new Error('not a cursor');
        return stored;
      },
      write: async (cursor) => {
        written.push(cursor);
      },
    },
    now: () => now,
    // Waits are tested by what happens, not by waiting.
    sleep: async () => undefined,
  });
  const incoming = chat.incoming[Symbol.asyncIterator]();
  return {
    chat,
    written,
    next: async (): Promise<Incoming> => (await incoming.next()).value,
  };
};

const within = <Value>(wait: Promise<Value>, what: string): Promise<Value> =>
  Promise.race([
    wait,
    Bun.sleep(3_000).then(() => {
      throw new Error(what);
    }),
  ]);

const nothingWithin = async (next: Promise<Incoming>): Promise<string> =>
  Promise.race([
    next.then((incoming) => incoming.entry.id),
    Bun.sleep(500).then(() => 'nothing'),
  ]);

test('after a restart the stream resumes from the stored id and the gap is caught up once it is open', async () => {
  const backend = fakeMacro();
  // Posted while the agent restarted: after the stored cursor.
  backend.post({ id: 'gap', at: '2026-11-19T11:59:30Z', text: 'you there?' });
  const { chat, next } = listening(backend, {
    eventId: 'e9',
    at: '2026-11-19T11:59:20Z',
  });

  const caught = next();
  await Bun.sleep(10);
  expect(backend.options()?.resume).toEqual({ lastEventId: 'e9' });
  // Nothing is read before the stream is open.
  expect(backend.activeSince).toEqual([]);

  backend.options()?.onOpen?.(now);
  expect(
    (await within(caught, 'the gap was never caught up')).entry
  ).toMatchObject({
    id: 'gap',
    dm: true,
    text: 'you there?',
  });
  await within(chat.listening(), 'not listening after the stream opened');
});

test('a stored cursor older than a day catches up only the last day', async () => {
  const backend = fakeMacro();
  const { next } = listening(backend, { at: '2026-11-10T00:00:00Z' });

  const pending = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  await Bun.sleep(50);

  expect(backend.activeSince).toEqual(['2026-11-18T12:00:00.000Z']);
  expect(await nothingWithin(pending)).toBe('nothing');
});

test('each handled event moves the cursor, and a first start records one when the stream opens', async () => {
  const backend = fakeMacro();
  const { next, written } = listening(backend, undefined);

  const first = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  await Bun.sleep(10);
  // No cursor yet: nothing to catch up, but a crash from here has one.
  expect(backend.activeSince).toEqual([]);
  expect(written).toEqual([{ at: now.toISOString() }]);

  await backend.live({ id: 'm1', at: '2026-11-19T12:00:01Z', text: 'hi' });
  expect((await first).entry.id).toBe('m1');
  backend.options()?.onEventId?.('e10');
  await Bun.sleep(10);
  expect(written.at(-1)).toEqual({ eventId: 'e10', at: now.toISOString() });
});

test('a message both replayed and caught up reaches the agent once, and a reply in a thread is caught up', async () => {
  const backend = fakeMacro();
  const { next } = listening(backend, { at: '2026-11-19T11:00:00Z' });

  const first = next();
  await Bun.sleep(10);
  await backend.live({ id: 'r1', at: '2026-11-19T11:30:00Z', text: 'plan?' });
  expect((await first).entry.id).toBe('r1');
  backend.post({
    id: 'r1-reply',
    at: '2026-11-19T11:40:00Z',
    text: 'news?',
    thread: 'r1',
  });

  backend.options()?.onOpen?.(now);
  expect(
    (await within(next(), 'the reply was never caught up')).entry
  ).toMatchObject({
    id: 'r1-reply',
    root: 'r1',
    thread: 'r1',
  });
  expect(await nothingWithin(next())).toBe('nothing');
});

test('the agent is listening only once the stream is open and a round trip worked', async () => {
  const backend = fakeMacro();
  const { chat, next } = listening(backend, undefined);
  void next();
  await Bun.sleep(10);

  const state = await Promise.race([
    chat.listening().then(() => 'listening'),
    Bun.sleep(100).then(() => 'not yet'),
  ]);
  expect(state).toBe('not yet');

  const before = backend.meCalls();
  backend.options()?.onOpen?.(now);
  await within(chat.listening(), 'never listening');
  expect(backend.meCalls()).toBeGreaterThan(before);
});

test('a channel that cannot be read is skipped, and a later catch-up still runs', async () => {
  const backend = fakeMacro();
  const { next } = listening(backend, { at: '2026-11-19T11:59:00Z' });

  const pending = next();
  await Bun.sleep(10);
  backend.unreadable(true);
  backend.options()?.onOpen?.(now);
  await Bun.sleep(50);

  backend.unreadable(false);
  backend.post({ id: 'later', at: '2026-11-19T11:59:40Z', text: 'still?' });
  backend.options()?.onDrop?.(now);
  backend.options()?.onOpen?.(now);
  expect((await within(pending, 'the later catch-up never ran')).entry.id).toBe(
    'later'
  );
});

test('the cursor stays at the oldest message not handled yet, so a restart reads it again', async () => {
  const backend = fakeMacro();
  const { chat, next, written } = listening(backend, {
    at: '2026-11-19T11:00:00Z',
  });

  const first = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  // Received, and its event id handed back, but the agent hasn't recorded
  // it: an exit now must not move the cursor past it.
  await backend.live({ id: 'q1', at: '2026-11-19T11:50:00Z', text: 'one' });
  await backend.live({ id: 'q2', at: '2026-11-19T11:55:00Z', text: 'two' });
  backend.options()?.onEventId?.('e2');
  await Bun.sleep(10);
  expect(written.at(-1)).toEqual({
    eventId: 'e2',
    at: '2026-11-19T11:50:00.000Z',
  });

  expect((await first).entry.id).toBe('q1');
  chat.handled('q1');
  await Bun.sleep(10);
  expect(written.at(-1)?.at).toBe('2026-11-19T11:55:00.000Z');
  chat.handled('q2');
  await Bun.sleep(10);
  expect(written.at(-1)?.at).toBe(now.toISOString());

  // A restart from the middle cursor reads q2 again.
  const restarted = fakeMacro();
  restarted.post({ id: 'q2', at: '2026-11-19T11:55:00Z', text: 'two' });
  const again = listening(restarted, { at: '2026-11-19T11:55:00.000Z' });
  const replayed = again.next();
  await Bun.sleep(10);
  restarted.options()?.onOpen?.(now);
  expect((await within(replayed, 'q2 was not read again')).entry.id).toBe('q2');
});

test('a round trip that fails at first is tried again, so a good boot still becomes healthy', async () => {
  const backend = fakeMacro();
  const { chat, next } = listening(backend, undefined);
  void next();
  await Bun.sleep(10);
  const before = backend.meCalls();
  backend.failMe(1);

  backend.options()?.onOpen?.(now);
  await within(chat.listening(), 'one failed round trip failed the boot');
  expect(backend.meCalls()).toBe(before + 2);
});

test('a cursor that cannot be read catches up the whole window, and says so', async () => {
  const backend = fakeMacro();
  backend.post({ id: 'old', at: '2026-11-19T01:00:00Z', text: 'earlier' });
  const spans: Record<string, unknown>[] = [];
  const { next } = listening(backend, 'unreadable', spans);

  const caught = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  expect((await within(caught, 'nothing was caught up')).entry.id).toBe('old');
  expect(backend.activeSince).toEqual(['2026-11-18T12:00:00.000Z']);
  expect(spans.at(-1)).toMatchObject({ 'chat.cursor.unreadable': true });
});

test('a root deleted during the restart is not delivered, its new reply is', async () => {
  const backend = fakeMacro();
  backend.post({
    id: 'gone',
    at: '2026-11-19T11:59:30Z',
    text: 'oops',
    deleted: true,
  });
  backend.post({
    id: 'gone-reply',
    at: '2026-11-19T11:59:40Z',
    text: 'what was that?',
    thread: 'gone',
  });
  const { next } = listening(backend, { at: '2026-11-19T11:59:20Z' });

  const caught = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  expect((await within(caught, 'nothing was caught up')).entry.id).toBe(
    'gone-reply'
  );
  expect(await nothingWithin(next())).toBe('nothing');
});

test('while a catch-up is still reading, the cursor stays before its gap', async () => {
  const backend = fakeMacro();
  const release = backend.hold();
  const { next, written } = listening(backend, { at: '2026-11-19T11:00:00Z' });

  void next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  await Bun.sleep(10);
  // A live event during the pass must not move the cursor past the gap.
  backend.options()?.onEventId?.('e5');
  await Bun.sleep(10);
  // The gap itself, not a margin before it, so repeated restarts don't walk
  // the cursor back.
  expect(written.at(-1)).toEqual({
    eventId: 'e5',
    at: '2026-11-19T11:00:00.000Z',
  });

  release();
  await Bun.sleep(20);
  expect(written.at(-1)).toEqual({ eventId: 'e5', at: now.toISOString() });
});

test('a catch-up the backend fails is tried again, and what it missed still arrives', async () => {
  const backend = fakeMacro();
  backend.post({ id: 'gap', at: '2026-11-19T11:59:30Z', text: 'you there?' });
  backend.failReads(1);
  const { next } = listening(backend, { at: '2026-11-19T11:59:20Z' });

  const caught = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  expect(
    (await within(caught, 'the failed read was never retried')).entry.id
  ).toBe('gap');
  expect(backend.activeSince).toHaveLength(2);
});

test('a channel the backend always fails is given up on, and the rest is still caught up', async () => {
  const backend = fakeMacro();
  backend.breakChannel();
  backend.post({ id: 'gap', at: '2026-11-19T11:59:30Z', text: 'you there?' });
  const spans: Record<string, unknown>[] = [];
  const { next, written } = listening(
    backend,
    { at: '2026-11-19T11:59:20Z' },
    spans
  );

  const caught = next();
  await Bun.sleep(10);
  backend.options()?.onOpen?.(now);
  expect((await within(caught, 'the rest was never caught up')).entry.id).toBe(
    'gap'
  );
  await Bun.sleep(20);
  expect(backend.brokenReads()).toBe(5);
  expect(spans.at(-1)).toMatchObject({ 'chat.catch_up.failed': 1 });
  // The pass ended: the cursor moves on once the gap is handled.
  expect(written.at(-1)?.at).toBe('2026-11-19T11:59:30.000Z');
});

test("a first lookup of the agent's own id that fails is tried again", async () => {
  const backend = fakeMacro();
  backend.failMe(1);
  const { chat, next } = listening(backend, undefined);
  void next();
  await Bun.sleep(10);

  backend.options()?.onOpen?.(now);
  await within(chat.listening(), 'the failed lookup failed the boot');
});
