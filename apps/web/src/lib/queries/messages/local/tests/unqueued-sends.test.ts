import { expect, it, vi } from 'vitest';
import {
  forgetUnqueuedSend,
  noteUnqueuedChange,
  noteUnqueuedSend,
  resendUnqueuedSends,
  type UnqueuedChange,
  type UnqueuedSend,
  type UnqueuedSendsDeps,
  type UnqueuedWriteHandlers,
} from '../unqueued-sends';

const SENDER = 'person-1';
const NOW = Date.parse('2026-01-01T00:00:10.000Z');
const CREATED_AT = '2026-01-01T00:00:00.000Z';

function send(id: string, senderId = SENDER): UnqueuedSend {
  return {
    channelId: 'channel-1',
    id,
    senderId,
    message: { content: `message ${id}` },
  };
}

function memoryStorage(): NonNullable<UnqueuedSendsDeps['storage']> {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/** Locks of the pages in `alivePages`; every request is granted at once. */
function pageLocks(
  alivePages: string[]
): NonNullable<UnqueuedSendsDeps['locks']> {
  return {
    request: (async (_name: string, callback: () => Promise<unknown>) =>
      await callback()) as LockManager['request'],
    query: async () => ({
      held: alivePages.map((pageId) => ({
        name: `channel-send-awaiting-queue:v1:page:${pageId}`,
      })),
    }),
  };
}

function world(alivePages: string[], queuedIds: string[] = []) {
  const storage = memoryStorage();
  const deps = (pageId: string): UnqueuedSendsDeps => ({
    storage,
    locks: pageLocks(alivePages),
    pageId,
    now: () => NOW,
  });
  const host = {
    inspectMutations: async () => queuedIds.map((uuid) => ({ uuid }) as never),
  };
  const resend = vi.fn<UnqueuedWriteHandlers['send']>();
  const change = vi.fn<UnqueuedWriteHandlers['change']>();
  const handlers: UnqueuedWriteHandlers = { send: resend, change };
  return { storage, deps, host, resend, change, handlers };
}

it('sends again what a page that is gone noted and never saw stored', async () => {
  const { deps, host, resend, handlers } = world(['new-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  const resent = await resendUnqueuedSends(
    host,
    SENDER,
    handlers,
    deps('new-page')
  );

  expect(resent).toBe(1);
  expect(resend).toHaveBeenCalledExactlyOnceWith(send('m1'), CREATED_AT);
});

it('sends again in the order the messages were written', async () => {
  const { deps, host, resend, handlers } = world(['new-page']);
  // Storage holds the later message first.
  noteUnqueuedSend(send('m2'), '2026-01-01T00:00:01.000Z', deps('old-page'));
  noteUnqueuedSend(send('m3'), '2026-01-01T00:00:01.000Z', deps('old-page'));
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'));

  expect(resend.mock.calls.map(([sent]) => sent.id)).toEqual([
    'm1',
    'm2',
    'm3',
  ]);
});

it('leaves alone a send whose page still runs, and one the queue stored', async () => {
  const { storage, deps, host, resend, handlers } = world([
    'other-tab',
    'new-page',
  ]);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('other-tab'));
  noteUnqueuedSend(send('m2'), CREATED_AT, deps('old-page')).stored();

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(1);
});

it('hands a send to one page only when two start together', async () => {
  const { deps, host, resend, handlers } = world(['page-a', 'page-b']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  await resendUnqueuedSends(host, SENDER, handlers, deps('page-a'));
  await resendUnqueuedSends(host, SENDER, handlers, deps('page-b'));

  expect(resend).toHaveBeenCalledOnce();
});

it('forgets a send the queue already holds instead of sending it twice', async () => {
  const { storage, deps, host, resend, handlers } = world(['new-page'], ['m1']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(0);
});

it('drops a send a day old, an unreadable or undated one, and leaves another person’s', async () => {
  const { storage, deps, host, resend, handlers } = world(['new-page']);
  noteUnqueuedSend(send('old'), '2025-12-30T00:00:00.000Z', deps('old-page'));
  storage.setItem(`channel-send-awaiting-queue:v1:${SENDER}:broken`, '{');
  noteUnqueuedSend(send('undated'), 'not a time', deps('old-page'));
  noteUnqueuedSend(send('theirs', 'person-2'), CREATED_AT, deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(1);
});

it('keeps a send whose queue request ended as its page was left', async () => {
  const { storage, deps, host, resend, handlers } = world(['new-page']);
  const stillRunning: (() => void)[] = [];
  const note = noteUnqueuedSend(send('m1'), CREATED_AT, {
    ...deps('old-page'),
    later: (work) => stillRunning.push(work),
  });
  // The unload fails the request, and the page never gets to run again.
  note.ended();

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(1);
  expect(resend).toHaveBeenCalledExactlyOnceWith(send('m1'), CREATED_AT);

  // A page that does go on forgets a send the queue refused.
  const refused = noteUnqueuedSend(send('m2'), CREATED_AT, {
    ...deps('new-page'),
    later: (work) => stillRunning.push(work),
  });
  refused.ended();
  for (const work of stillRunning) work();
  expect(
    storage.getItem(`channel-send-awaiting-queue:v1:${SENDER}:m2`)
  ).toBeNull();
});

it('hands every noted send on when there is no queue to ask', async () => {
  const { deps, resend, handlers } = world(['new-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  const resent = await resendUnqueuedSends(
    {},
    SENDER,
    handlers,
    deps('new-page')
  );

  expect(resent).toBe(1);
  expect(resend).toHaveBeenCalledExactlyOnceWith(send('m1'), CREATED_AT);
});

it('a forgotten send is not sent again by a later page', async () => {
  const { storage, deps, host, handlers } = world(['newer-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  forgetUnqueuedSend(SENDER, 'm1', { storage });
  const resent = await resendUnqueuedSends(
    host,
    SENDER,
    handlers,
    deps('newer-page')
  );

  expect(resent).toBe(0);
  expect(storage.length).toBe(0);
});

function edit(uuid: string): UnqueuedChange {
  return {
    kind: 'edit',
    uuid,
    senderId: SENDER,
    channelId: 'channel-1',
    id: 'm1',
    nonce: `nonce-${uuid}`,
    content: 'edited',
    mentions: [],
    removeAttachmentIds: [],
    addAttachments: [],
  };
}

it('makes again an edit, a removal and a reaction a page that is gone left behind, after the send they change', async () => {
  const { deps, host, resend, change, handlers } = world(['new-page']);
  const order: string[] = [];
  resend.mockImplementation((sent) => order.push(`send ${sent.id}`));
  change.mockImplementation((made) => order.push(`${made.kind} ${made.id}`));
  const removal: UnqueuedChange = {
    kind: 'delete',
    uuid: 'u3',
    senderId: SENDER,
    channelId: 'channel-1',
    id: 'm0',
    nonce: 'nonce-u3',
  };
  const reaction: UnqueuedChange = {
    kind: 'react',
    uuid: 'u4',
    senderId: SENDER,
    channelId: 'channel-1',
    id: 'm9',
    nonce: 'nonce-u4',
    emoji: '👍',
    add: true,
  };
  // Storage holds the edit before the message it edits.
  noteUnqueuedChange(edit('u2'), '2026-01-01T00:00:02.000Z', deps('old-page'));
  noteUnqueuedChange(reaction, '2026-01-01T00:00:04.000Z', deps('old-page'));
  noteUnqueuedChange(removal, '2026-01-01T00:00:03.000Z', deps('old-page'));
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(4);
  expect(order).toEqual(['send m1', 'edit m1', 'delete m0', 'react m9']);
  expect(change).toHaveBeenCalledWith(edit('u2'), '2026-01-01T00:00:02.000Z');
});

it('leaves alone a change the queue stored, and one its page saw stored', async () => {
  const { storage, deps, resend, change, handlers } = world(
    ['new-page'],
    ['u1']
  );
  const host = {
    inspectMutations: async () => [{ uuid: 'u1' } as never],
  };
  noteUnqueuedChange(edit('u1'), CREATED_AT, deps('old-page'));
  noteUnqueuedChange(edit('u2'), CREATED_AT, deps('old-page')).stored();

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(0);
  expect(change).not.toHaveBeenCalled();
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(0);
});

it('does not make again a change older than minutes, which could undo a later one', async () => {
  const { storage, deps, host, resend, change, handlers } = world(['new-page']);
  const anHourBefore = new Date(Date.parse(CREATED_AT) - 60 * 60_000);
  noteUnqueuedChange(edit('u1'), anHourBefore.toISOString(), deps('old-page'));
  // A send of the same age is still sent: the server answers it as stored.
  noteUnqueuedSend(send('m1'), anHourBefore.toISOString(), deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, handlers, deps('new-page'))
  ).toBe(1);
  expect(change).not.toHaveBeenCalled();
  expect(resend).toHaveBeenCalledOnce();
  expect(storage.length).toBe(1);
});
