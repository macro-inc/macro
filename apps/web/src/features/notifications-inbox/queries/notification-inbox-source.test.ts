import { createFakeAttentionFeedClient } from '@queries/attention-feed/tests/fake-client';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  InboxFeedSource,
  InboxScope,
} from '../context/notifications-inbox-context';
import { ALL_INBOX_ROW_TYPES } from '../core/inbox-filters';
import {
  inboxEntry,
  inboxPage,
  removedPatch,
  upsertedPatch,
} from '../tests/wire';
import { createNotificationInboxSource } from './notification-inbox-source';

// Row mapping imports allBlocks, which loads every block module; one of them
// opens a websocket that jsdom rejects after the test ends.
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
});

/** Let timers at zero and the cache's promise chains run out. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

const WIRE_SCOPE = { rowTypes: [] };

const docA = inboxEntry({
  docId: 'doc-a',
  sortAt: '2026-02-01T10:09:00Z',
  rows: [
    {
      id: 'document:doc-a#top_level',
      latestAt: '2026-02-01T10:09:00Z',
    },
    {
      id: 'document:doc-a#task',
      rowType: 'TASK',
      latestAt: '2026-02-01T10:08:00Z',
    },
  ],
});
const docB = inboxEntry({
  docId: 'doc-b',
  sortAt: '2026-02-01T10:05:00Z',
  rows: [
    {
      id: 'document:doc-b#top_level',
      latestAt: '2026-02-01T10:05:00Z',
    },
  ],
});
const docC = inboxEntry({
  docId: 'doc-c',
  sortAt: '2026-02-01T10:07:00Z',
  rows: [
    {
      id: 'document:doc-c#top_level',
      latestAt: '2026-02-01T10:07:00Z',
    },
  ],
});

function setup(
  mutationData: Record<string, unknown> = {},
  scope: () => InboxScope = () => ({ rowTypes: ALL_INBOX_ROW_TYPES })
) {
  const fake = createFakeAttentionFeedClient(mutationData);
  const revalidateNotifications = vi.fn(async () => {});
  const restoreNotifications = vi.fn();
  const overrideNotificationsDone = vi.fn(() => restoreNotifications);
  let feed!: InboxFeedSource;
  const dispose = createRoot((rootDispose) => {
    feed = createNotificationInboxSource({
      client: () => fake.client,
      cacheHost: () => fake.host,
      scope,
      enabled: () => true,
      overrideNotificationsDone,
      revalidateNotifications,
    });
    return rootDispose;
  });
  disposals.push(dispose);
  const rowIds = () => feed.rows()?.map((row) => row.id);
  const row = (id: string) => {
    const found = feed.rows()?.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`${id} missing`);
    return found;
  };
  return {
    fake,
    feed,
    rowIds,
    row,
    overrideNotificationsDone,
    restoreNotifications,
    revalidateNotifications,
  };
}

async function loaded(mutationData: Record<string, unknown> = {}) {
  const context = setup(mutationData);
  await flush();
  context.fake.queries[0].resolve(inboxPage([docA, docB]));
  await flush();
  return context;
}

const doneResult = {
  MarkNotificationInboxRowsDone: {
    markNotificationInboxRowsDone: { rowIds: [], undoToken: 'undo-1' },
  },
};

describe('createNotificationInboxSource', () => {
  it('reads the inbox and lists every row newest first', async () => {
    vi.useFakeTimers();
    const { fake, feed, rowIds } = setup();
    await flush();
    expect(feed.rows()).toBeUndefined();
    expect(fake.queries[0].variables).toEqual({
      input: { scope: WIRE_SCOPE, limit: 50, cursor: null },
    });
    expect(fake.subscriptions[0].variables).toEqual({ scope: WIRE_SCOPE });

    fake.queries[0].resolve(inboxPage([docA, docB]));
    await flush();

    expect(rowIds()).toEqual([
      'document:doc-a#top_level',
      'document:doc-a#task',
      'document:doc-b#top_level',
    ]);
  });

  it('writes live changes into the cached pages without a read', async () => {
    vi.useFakeTimers();
    const { fake, rowIds } = await loaded();
    const reads = fake.queries.length;

    fake.subscriptions[0].next({
      notificationInboxUpdates: [
        upsertedPatch(docC),
        removedPatch('document:doc-a'),
      ],
    });
    await flush();

    expect(fake.queries).toHaveLength(reads);
    expect(rowIds()).toEqual([
      'document:doc-c#top_level',
      'document:doc-b#top_level',
    ]);
  });

  it('keeps the object of a row a live change did not touch', async () => {
    vi.useFakeTimers();
    const { fake, row } = await loaded();
    const untouched = row('document:doc-a#top_level');

    fake.subscriptions[0].next({
      notificationInboxUpdates: [
        upsertedPatch(
          inboxEntry({
            docId: 'doc-b',
            sortAt: '2026-03-01T00:00:00Z',
            rows: [
              {
                id: 'document:doc-b#top_level',
                latestAt: '2026-03-01T00:00:00Z',
                revision: 'rev-b-2',
                notificationIds: ['n-b-1', 'n-b-2'],
              },
            ],
          })
        ),
      ],
    });
    await flush();

    expect(row('document:doc-b#top_level').count).toBe(2);
    expect(row('document:doc-a#top_level')).toBe(untouched);
  });

  it('marks one row done at its revision and hides only that row', async () => {
    vi.useFakeTimers();
    const { fake, feed, row, rowIds, overrideNotificationsDone } =
      await loaded(doneResult);

    await feed.markDone([row('document:doc-a#task')]);

    expect(fake.mutations[0]).toEqual({
      name: 'MarkNotificationInboxRowsDone',
      variables: {
        input: {
          rows: [
            { id: 'document:doc-a#task', revision: 'rev-document:doc-a#task' },
          ],
        },
      },
    });
    expect(overrideNotificationsDone).toHaveBeenCalledWith([
      'n-document:doc-a#task',
    ]);
    expect(rowIds()).toEqual([
      'document:doc-a#top_level',
      'document:doc-b#top_level',
    ]);
  });

  it('shows the row again when the done fails', async () => {
    vi.useFakeTimers();
    const { feed, row, rowIds, restoreNotifications } = await loaded();

    await expect(feed.markDone([row('document:doc-a#task')])).rejects.toThrow();

    expect(restoreNotifications).toHaveBeenCalled();
    expect(rowIds()).toContain('document:doc-a#task');
  });

  const stacked = inboxEntry({
    docId: 'doc-s',
    sortAt: '2026-02-01T10:09:00Z',
    rows: [
      {
        id: 'document:doc-s#top_level',
        latestAt: '2026-02-01T10:09:00Z',
        notificationIds: ['n-3', 'n-2', 'n-1'],
      },
    ],
  });

  async function loadedStack(mutationData: Record<string, unknown> = {}) {
    const context = setup(mutationData);
    await flush();
    context.fake.queries[0].resolve(inboxPage([stacked]));
    await flush();
    return context;
  }

  it('hides one notification of a stack and completes only it', async () => {
    vi.useFakeTimers();
    const { fake, feed, row, overrideNotificationsDone } = await loadedStack({
      MarkNotificationInboxNotificationDone: {
        markNotificationInboxNotificationDone: {
          patches: [],
          undoToken: 'undo-n-2',
        },
      },
    });
    const stack = row('document:doc-s#top_level');

    await feed.markNotificationDone(stack, stack.content.notifications[1]);

    expect(fake.mutations[0]).toEqual({
      name: 'MarkNotificationInboxNotificationDone',
      variables: {
        input: {
          rowId: 'document:doc-s#top_level',
          notificationId: 'n-2',
          scope: WIRE_SCOPE,
        },
      },
    });
    expect(overrideNotificationsDone).toHaveBeenCalledWith(['n-2']);
    const after = row('document:doc-s#top_level');
    expect(after.count).toBe(2);
    expect(after.content.notifications.map(({ id }) => id)).toEqual([
      'n-3',
      'n-1',
    ]);
  });

  it('shows the notification again when its done fails', async () => {
    vi.useFakeTimers();
    const { feed, row, restoreNotifications } = await loadedStack();
    const stack = row('document:doc-s#top_level');

    await expect(
      feed.markNotificationDone(stack, stack.content.notifications[1])
    ).rejects.toThrow();

    expect(restoreNotifications).toHaveBeenCalled();
    expect(row('document:doc-s#top_level').count).toBe(3);
  });

  it('clears the inbox in batches, hiding the loaded rows it takes', async () => {
    vi.useFakeTimers();
    let batch = 0;
    const { fake, feed, rowIds } = await loaded({
      get ClearNotificationInbox() {
        batch += 1;
        return {
          clearNotificationInbox: {
            rowCount: 2,
            undoToken: `undo-${batch}`,
            nextCursor: batch < 3 ? `cursor-${batch}` : null,
          },
        };
      },
      UndoNotificationInboxRowsDone: {
        undoNotificationInboxRowsDone: { patches: [] },
      },
    });

    const cleared = await feed.clear({
      lane: 'signal',
      rowTypes: ['task'],
      unreadOnly: false,
    });

    expect(cleared.count).toBe(6);
    const clears = fake.mutations.filter(
      ({ name }) => name === 'ClearNotificationInbox'
    );
    expect(clears.map(({ variables }) => variables)).toEqual([
      {
        input: {
          scope: { rowTypes: ['TASK'] },
          since: null,
          cursor: null,
        },
      },
      expect.objectContaining({
        input: expect.objectContaining({ cursor: 'cursor-1' }),
      }),
      expect.objectContaining({
        input: expect.objectContaining({ cursor: 'cursor-2' }),
      }),
    ]);
    // Only the task row matches what was cleared.
    expect(rowIds()).toEqual([
      'document:doc-a#top_level',
      'document:doc-b#top_level',
    ]);

    await cleared.undo();
    const undos = fake.mutations.filter(
      ({ name }) => name === 'UndoNotificationInboxRowsDone'
    );
    expect(undos.map(({ variables }) => variables.input)).toEqual([
      expect.objectContaining({ undoToken: 'undo-1' }),
      expect.objectContaining({ undoToken: 'undo-2' }),
      expect.objectContaining({ undoToken: 'undo-3' }),
    ]);
    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('shows the cleared rows again when the clear fails', async () => {
    vi.useFakeTimers();
    const { feed, rowIds } = await loaded();

    await expect(
      feed.clear({ lane: 'signal', rowTypes: ['task'], unreadOnly: false })
    ).rejects.toThrow();

    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('shows a done row again when a newer notification reopens it', async () => {
    vi.useFakeTimers();
    const { fake, feed, row, rowIds } = await loaded(doneResult);
    await feed.markDone([row('document:doc-a#task')]);

    const reopened = inboxEntry({
      docId: 'doc-a',
      sortAt: '2026-02-01T10:10:00Z',
      rows: [
        {
          id: 'document:doc-a#task',
          rowType: 'TASK',
          latestAt: '2026-02-01T10:10:00Z',
          revision: 'rev-newer',
        },
      ],
    });
    fake.subscriptions[0].next({
      notificationInboxUpdates: [upsertedPatch(reopened)],
    });
    await flush();

    expect(rowIds()).toEqual([
      'document:doc-a#task',
      'document:doc-b#top_level',
    ]);
  });

  it('undo restores the row in the place the server returns', async () => {
    vi.useFakeTimers();
    const { fake, feed, row, rowIds, restoreNotifications } = await loaded({
      ...doneResult,
      UndoNotificationInboxRowsDone: {
        undoNotificationInboxRowsDone: { patches: [upsertedPatch(docB)] },
      },
    });
    const done = await feed.markDone([row('document:doc-b#top_level')]);
    fake.subscriptions[0].next({
      notificationInboxUpdates: [removedPatch('document:doc-b')],
    });
    await flush();
    expect(rowIds()).not.toContain('document:doc-b#top_level');

    await done.undo();
    await flush();

    expect(fake.mutations[1]).toEqual({
      name: 'UndoNotificationInboxRowsDone',
      variables: { input: { undoToken: 'undo-1', scope: WIRE_SCOPE } },
    });
    expect(restoreNotifications).toHaveBeenCalled();
    expect(rowIds()).toContain('document:doc-b#top_level');
  });

  it('undoes into the filter showing now, not the one the done came from', async () => {
    vi.useFakeTimers();
    const [scope, setScope] = createSignal<InboxScope>({
      rowTypes: ALL_INBOX_ROW_TYPES,
    });
    const { fake, feed, row } = setup(
      {
        ...doneResult,
        UndoNotificationInboxRowsDone: {
          undoNotificationInboxRowsDone: { patches: [] },
        },
      },
      scope
    );
    await flush();
    fake.queries[0].resolve(inboxPage([docA, docB]));
    await flush();
    const done = await feed.markDone([row('document:doc-b#top_level')]);

    setScope({ rowTypes: ['email'] });
    await done.undo();

    expect(fake.mutations[1]).toEqual({
      name: 'UndoNotificationInboxRowsDone',
      variables: {
        input: { undoToken: 'undo-1', scope: { rowTypes: ['EMAIL'] } },
      },
    });
  });

  it('drops an undo’s patches when the filter changed while it was in flight', async () => {
    vi.useFakeTimers();
    const [scope, setScope] = createSignal<InboxScope>({
      rowTypes: ALL_INBOX_ROW_TYPES,
    });
    let answerUndo = (_answer: unknown) => {};
    const undoAnswer = new Promise((resolve) => {
      answerUndo = resolve;
    });
    const { fake, feed, row, rowIds } = setup(
      { ...doneResult, UndoNotificationInboxRowsDone: undoAnswer },
      scope
    );
    await flush();
    fake.queries[0].resolve(inboxPage([docA, docB]));
    await flush();
    const done = await feed.markDone([row('document:doc-b#top_level')]);

    const undoing = done.undo();
    setScope({ rowTypes: ['task'] });
    await flush();
    fake.queries.at(-1)?.resolve(inboxPage([docA]));
    await flush();
    answerUndo({
      undoNotificationInboxRowsDone: { patches: [upsertedPatch(docC)] },
    });
    await undoing;
    await flush();

    expect(rowIds()).not.toContain('document:doc-c#top_level');
    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('reads a row as seen at once and marks it seen by row', async () => {
    vi.useFakeTimers();
    const seenEntry = inboxEntry({
      docId: 'doc-a',
      sortAt: '2026-02-01T10:09:00Z',
      rows: [
        {
          id: 'document:doc-a#top_level',
          latestAt: '2026-02-01T10:09:00Z',
          unseen: false,
        },
      ],
    });
    const { fake, feed, row, revalidateNotifications } = await loaded({
      MarkNotificationInboxRowsSeen: {
        markNotificationInboxRowsSeen: { patches: [upsertedPatch(seenEntry)] },
      },
    });

    const seen = feed.markSeen([row('document:doc-a#top_level')]);
    expect(row('document:doc-a#top_level').unseen).toBe(false);
    await seen;
    await flush();

    expect(fake.mutations[0]).toEqual({
      name: 'MarkNotificationInboxRowsSeen',
      variables: {
        input: { rowIds: ['document:doc-a#top_level'], scope: WIRE_SCOPE },
      },
    });
    expect(revalidateNotifications).toHaveBeenCalled();
    expect(row('document:doc-a#top_level').unseen).toBe(false);
  });

  it('reads unread rows from the server under Unread, live changes too', async () => {
    vi.useFakeTimers();
    const { fake } = setup({}, () => ({
      rowTypes: ALL_INBOX_ROW_TYPES,
      unreadOnly: true,
    }));
    await flush();

    const unreadScope = { rowTypes: [], unreadOnly: true };
    expect(fake.queries[0].variables).toEqual({
      input: { scope: unreadScope, limit: 50, cursor: null },
    });
    expect(fake.subscriptions[0].variables).toEqual({ scope: unreadScope });
  });

  it('keeps a row read here under Unread until the scope changes', async () => {
    vi.useFakeTimers();
    const [scope, setScope] = createSignal<InboxScope>({
      rowTypes: ALL_INBOX_ROW_TYPES,
      unreadOnly: true,
    });
    const { fake, feed, row, rowIds } = setup(
      {
        // Read, doc-b leaves the server's unread inbox.
        MarkNotificationInboxRowsSeen: {
          markNotificationInboxRowsSeen: {
            patches: [removedPatch(docB.groupId)],
          },
        },
      },
      scope
    );
    await flush();
    fake.queries[0].resolve(inboxPage([docA, docB]));
    await flush();

    await feed.markSeen([row('document:doc-b#top_level')]);
    await flush();
    expect(rowIds()).toContain('document:doc-b#top_level');
    expect(row('document:doc-b#top_level').unseen).toBe(false);

    setScope({ rowTypes: ALL_INBOX_ROW_TYPES });
    await flush();
    setScope({ rowTypes: ALL_INBOX_ROW_TYPES, unreadOnly: true });
    await flush();
    fake.queries.at(-1)?.resolve(inboxPage([docA]));
    await flush();
    expect(rowIds()).not.toContain('document:doc-b#top_level');
  });

  it('clears unread rows by the scope it sends', async () => {
    vi.useFakeTimers();
    const { fake, feed } = await loaded({
      ClearNotificationInbox: {
        clearNotificationInbox: {
          rowCount: 1,
          undoToken: 'undo-1',
          nextCursor: null,
        },
      },
    });

    await feed.clear({
      lane: 'signal',
      rowTypes: ALL_INBOX_ROW_TYPES,
      unreadOnly: true,
    });

    expect(fake.mutations[0].variables).toEqual({
      input: {
        scope: { rowTypes: [], unreadOnly: true },
        since: null,
        cursor: null,
      },
    });
  });

  it('reads, follows and clears the lane its scope names', async () => {
    vi.useFakeTimers();
    const noise = { lane: 'NOISE', rowTypes: [] };
    const { fake, feed } = setup(
      {
        ClearNotificationInbox: {
          clearNotificationInbox: {
            rowCount: 0,
            undoToken: 'undo-1',
            nextCursor: null,
          },
        },
      },
      () => ({ lane: 'noise', rowTypes: ALL_INBOX_ROW_TYPES })
    );
    await flush();

    expect(fake.queries[0].variables).toEqual({
      input: { scope: noise, limit: 50, cursor: null },
    });
    expect(fake.subscriptions[0].variables).toEqual({ scope: noise });

    fake.queries[0].resolve(inboxPage([]));
    await flush();
    await feed.clear({
      lane: 'noise',
      rowTypes: ALL_INBOX_ROW_TYPES,
      unreadOnly: false,
    });

    expect(fake.mutations[0].variables).toEqual({
      input: { scope: noise, since: null, cursor: null },
    });
  });

  it('reads the row as unseen again when marking it seen fails', async () => {
    vi.useFakeTimers();
    const { feed, row } = await loaded();

    await expect(
      feed.markSeen([row('document:doc-a#top_level')])
    ).rejects.toThrow();

    expect(row('document:doc-a#top_level').unseen).toBe(true);
  });
});
