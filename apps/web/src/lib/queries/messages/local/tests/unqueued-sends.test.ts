import { expect, it, vi } from 'vitest';
import {
  forgetUnqueuedSend,
  noteUnqueuedSend,
  resendUnqueuedSends,
  type UnqueuedSend,
  type UnqueuedSendsDeps,
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
  const resend = vi.fn<(send: UnqueuedSend, createdAt: string) => void>();
  return { storage, deps, host, resend };
}

it('sends again what a page that is gone noted and never saw stored', async () => {
  const { deps, host, resend } = world(['new-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  const resent = await resendUnqueuedSends(
    host,
    SENDER,
    resend,
    deps('new-page')
  );

  expect(resent).toBe(1);
  expect(resend).toHaveBeenCalledExactlyOnceWith(send('m1'), CREATED_AT);
});

it('sends again in the order the messages were written', async () => {
  const { deps, host, resend } = world(['new-page']);
  // Storage holds the later message first.
  noteUnqueuedSend(send('m2'), '2026-01-01T00:00:01.000Z', deps('old-page'));
  noteUnqueuedSend(send('m3'), '2026-01-01T00:00:01.000Z', deps('old-page'));
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  await resendUnqueuedSends(host, SENDER, resend, deps('new-page'));

  expect(resend.mock.calls.map(([sent]) => sent.id)).toEqual([
    'm1',
    'm2',
    'm3',
  ]);
});

it('leaves alone a send whose page still runs, and one the queue stored', async () => {
  const { storage, deps, host, resend } = world(['other-tab', 'new-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('other-tab'));
  noteUnqueuedSend(send('m2'), CREATED_AT, deps('old-page')).stored();

  expect(
    await resendUnqueuedSends(host, SENDER, resend, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(1);
});

it('hands a send to one page only when two start together', async () => {
  const { deps, host, resend } = world(['page-a', 'page-b']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  await resendUnqueuedSends(host, SENDER, resend, deps('page-a'));
  await resendUnqueuedSends(host, SENDER, resend, deps('page-b'));

  expect(resend).toHaveBeenCalledOnce();
});

it('forgets a send the queue already holds instead of sending it twice', async () => {
  const { storage, deps, host, resend } = world(['new-page'], ['m1']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, resend, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(0);
});

it('drops a send a day old, an unreadable or undated one, and leaves another person’s', async () => {
  const { storage, deps, host, resend } = world(['new-page']);
  noteUnqueuedSend(send('old'), '2025-12-30T00:00:00.000Z', deps('old-page'));
  storage.setItem(`channel-send-awaiting-queue:v1:${SENDER}:broken`, '{');
  noteUnqueuedSend(send('undated'), 'not a time', deps('old-page'));
  noteUnqueuedSend(send('theirs', 'person-2'), CREATED_AT, deps('old-page'));

  expect(
    await resendUnqueuedSends(host, SENDER, resend, deps('new-page'))
  ).toBe(0);
  expect(resend).not.toHaveBeenCalled();
  expect(storage.length).toBe(1);
});

it('keeps a send whose queue request ended as its page was left', async () => {
  const { storage, deps, host, resend } = world(['new-page']);
  const stillRunning: (() => void)[] = [];
  const note = noteUnqueuedSend(send('m1'), CREATED_AT, {
    ...deps('old-page'),
    later: (work) => stillRunning.push(work),
  });
  // The unload fails the request, and the page never gets to run again.
  note.ended();

  expect(
    await resendUnqueuedSends(host, SENDER, resend, deps('new-page'))
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
  const { deps, resend } = world(['new-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  const resent = await resendUnqueuedSends(
    {},
    SENDER,
    resend,
    deps('new-page')
  );

  expect(resent).toBe(1);
  expect(resend).toHaveBeenCalledExactlyOnceWith(send('m1'), CREATED_AT);
});

it('a forgotten send is not sent again by a later page', async () => {
  const { storage, deps, host, resend } = world(['newer-page']);
  noteUnqueuedSend(send('m1'), CREATED_AT, deps('old-page'));

  forgetUnqueuedSend(SENDER, 'm1', { storage });
  const resent = await resendUnqueuedSends(
    host,
    SENDER,
    resend,
    deps('newer-page')
  );

  expect(resent).toBe(0);
  expect(storage.length).toBe(0);
});
