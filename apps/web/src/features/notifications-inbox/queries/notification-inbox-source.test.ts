import { fireAndForget } from '@core/util/fireAndForget';
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

/** The id every clear started in these tests gets. */
const CLEAR_ID = '0193b1ea-a542-7589-893b-2b4a509c1e76';
vi.mock('uuid', () => ({ v7: () => '0193b1ea-a542-7589-893b-2b4a509c1e76' }));

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
  // The gateway's hint that a clear changed, as another device causes.
  let hintClear: (clearId: string) => void = () => {};
  const dispose = createRoot((rootDispose) => {
    feed = createNotificationInboxSource({
      client: () => fake.client,
      cacheHost: () => fake.host,
      scope,
      enabled: () => true,
      onClearUpdated: (listener) => {
        hintClear = listener;
      },
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
    hintClear: (clearId: string) => hintClear(clearId),
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

/** A clear of task rows as the server reports it, started at 10:30. */
const wireClear = (
  status: string,
  fields: { rowCount?: number; revision?: number; clearId?: string } = {}
) => ({
  clearId: fields.clearId ?? CLEAR_ID,
  status,
  rowTypes: ['TASK'],
  unreadOnly: false,
  since: null,
  asOf: '2026-02-01T10:30:00+00:00',
  rowCount: fields.rowCount ?? 6,
  revision: fields.revision ?? 1,
});

/** Answers for the reads of clears, in order; the last one repeats. */
const clearReads = (...answers: unknown[][]) => {
  let read = 0;
  return () => ({
    user: {
      notificationInboxClears: answers[Math.min(read++, answers.length - 1)],
    },
  });
};

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

  it('clears the inbox in one call under its own id, hiding the rows it takes, and undoes it by that id', async () => {
    vi.useFakeTimers();
    const { fake, feed, rowIds } = await loaded({
      ClearNotificationInbox: {
        clearNotificationInbox: { clear: wireClear('DONE') },
      },
      UndoNotificationInboxClear: {
        undoNotificationInboxClear: { clear: wireClear('UNDONE') },
      },
    });

    const cleared = await feed.clear({
      rowTypes: ['task'],
      unreadOnly: false,
    });

    expect(cleared).toMatchObject({ count: 6, complete: true });
    expect(cleared.finished).toBeUndefined();
    const clears = fake.mutations.filter(
      ({ name }) => name === 'ClearNotificationInbox'
    );
    expect(clears.map(({ variables }) => variables)).toEqual([
      {
        input: {
          clearId: CLEAR_ID,
          scope: { rowTypes: ['TASK'] },
          since: null,
        },
      },
    ]);
    // Only the task row matches what was cleared.
    expect(rowIds()).toEqual([
      'document:doc-a#top_level',
      'document:doc-b#top_level',
    ]);

    await cleared.undo();
    const undos = fake.mutations.filter(
      ({ name }) => name === 'UndoNotificationInboxClear'
    );
    const sent = clears[0].variables.input as { clearId: string };
    expect(undos.map(({ variables }) => variables)).toEqual([
      { input: { clearId: sent.clearId } },
    ]);
    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('keeps hiding what a clear still at work takes, and announces its end', async () => {
    vi.useFakeTimers();
    const { fake, feed, rowIds } = await loaded({
      ClearNotificationInbox: {
        clearNotificationInbox: {
          clear: wireClear('APPLYING', { rowCount: 2 }),
        },
      },
      NotificationInboxClears: clearReads(
        // Nothing at work when the inbox opens.
        [],
        [wireClear('APPLYING', { rowCount: 40, revision: 2 })],
        [wireClear('DONE', { rowCount: 90, revision: 3 })]
      ),
    });

    const cleared = await feed.clear({ rowTypes: ['task'], unreadOnly: false });
    expect(cleared).toMatchObject({ count: 2, complete: false });
    let finished: number | undefined;
    fireAndForget(
      (async () => {
        finished = await cleared.finished;
      })(),
      'test'
    );

    // The inbox is read again; the server hasn't reached the task row yet.
    fake.queries.at(-1)?.resolve(inboxPage([docA, docB]));
    await flush();
    expect(rowIds()).not.toContain('document:doc-a#task');

    // A task row the server hasn't reached yet arrives with a later page:
    // it is hidden too. One from after the clear started is not.
    const later = inboxEntry({
      docId: 'doc-d',
      sortAt: '2026-02-01T10:40:00Z',
      rows: [
        {
          id: 'document:doc-d#task',
          rowType: 'TASK',
          latestAt: '2026-02-01T10:20:00Z',
        },
      ],
    });
    const arrived = inboxEntry({
      docId: 'doc-e',
      sortAt: '2026-02-01T10:45:00Z',
      rows: [
        {
          id: 'document:doc-e#task',
          rowType: 'TASK',
          latestAt: '2026-02-01T10:45:00Z',
        },
      ],
    });
    fake.subscriptions[0].next({
      notificationInboxUpdates: [upsertedPatch(later), upsertedPatch(arrived)],
    });
    await flush();
    expect(rowIds()).not.toContain('document:doc-d#task');
    expect(rowIds()).toContain('document:doc-e#task');

    // Still at work on the first poll, done on the second.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(finished).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(finished).toBe(90);
  });

  it('hides the rows of a clear another device started, as soon as it hears of it', async () => {
    vi.useFakeTimers();
    const { fake, hintClear, rowIds } = await loaded({
      NotificationInboxClears: clearReads(
        // Nothing at work when the inbox opens.
        [],
        [wireClear('APPLYING')],
        [wireClear('DONE', { revision: 2 })]
      ),
    });
    expect(rowIds()).toContain('document:doc-a#task');
    const refetches = fake.queries.length;

    hintClear(CLEAR_ID);
    await flush();

    expect(fake.reads.at(-1)).toEqual({
      name: 'NotificationInboxClears',
      variables: { clearId: CLEAR_ID },
    });
    expect(rowIds()).toEqual([
      'document:doc-a#top_level',
      'document:doc-b#top_level',
    ]);

    // It ends there: the inbox is read again here.
    hintClear(CLEAR_ID);
    await flush();
    expect(fake.queries.length).toBeGreaterThan(refetches);
  });

  it('shows the rows again when another device undoes a clear', async () => {
    vi.useFakeTimers();
    const { hintClear, rowIds } = await loaded({
      NotificationInboxClears: clearReads(
        [wireClear('APPLYING')],
        [wireClear('UNDOING', { revision: 2 })]
      ),
    });
    await flush();
    expect(rowIds()).not.toContain('document:doc-a#task');

    hintClear(CLEAR_ID);
    await flush();

    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('undoes a clear still at work and waits for the server to finish the undo', async () => {
    vi.useFakeTimers();
    const { feed, rowIds } = await loaded({
      ClearNotificationInbox: {
        clearNotificationInbox: { clear: wireClear('APPLYING') },
      },
      UndoNotificationInboxClear: {
        undoNotificationInboxClear: {
          clear: wireClear('UNDOING', { revision: 2 }),
        },
      },
      NotificationInboxClears: clearReads(
        [],
        [wireClear('UNDONE', { revision: 3 })]
      ),
    });
    const cleared = await feed.clear({ rowTypes: ['task'], unreadOnly: false });
    expect(rowIds()).not.toContain('document:doc-a#task');

    let undone = false;
    fireAndForget(
      (async () => {
        await cleared.undo();
        undone = true;
      })(),
      'test'
    );
    await flush();
    // The rows are back before the server is done.
    expect(rowIds()).toContain('document:doc-a#task');
    expect(undone).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(undone).toBe(true);
    // An undone clear is not announced as finished.
    expect(await cleared.finished).toBeUndefined();
  });

  it('keeps a clear whose reply was lost: the server has it', async () => {
    vi.useFakeTimers();
    const { feed, rowIds } = await loaded({
      // The mutation answers nothing, as a dropped connection leaves it.
      NotificationInboxClears: clearReads([], [wireClear('DONE')]),
    });

    const cleared = await feed.clear({ rowTypes: ['task'], unreadOnly: false });

    expect(cleared).toMatchObject({ count: 6, complete: true });
    expect(rowIds()).not.toContain('document:doc-a#task');
  });

  it('sends nothing when every kind is hidden', async () => {
    vi.useFakeTimers();
    const { fake, feed, rowIds } = await loaded();

    const cleared = await feed.clear({ rowTypes: [], unreadOnly: false });

    expect(cleared).toMatchObject({ count: 0, complete: true });
    expect(fake.mutations).toEqual([]);
    expect(rowIds()).toContain('document:doc-a#task');
  });

  it('shows the cleared rows again when the clear could not be started', async () => {
    vi.useFakeTimers();
    const { feed, rowIds } = await loaded();

    await expect(
      feed.clear({ rowTypes: ['task'], unreadOnly: false })
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

  it('names every kind it clears, even when that is all of them', async () => {
    vi.useFakeTimers();
    const { fake, feed } = await loaded({
      ClearNotificationInbox: {
        clearNotificationInbox: { clear: wireClear('DONE') },
      },
    });

    await feed.clear({ rowTypes: ALL_INBOX_ROW_TYPES, unreadOnly: true });

    const input = fake.mutations[0].variables.input as {
      scope: { rowTypes: string[]; unreadOnly: boolean };
    };
    expect(input.scope.rowTypes).toHaveLength(ALL_INBOX_ROW_TYPES.length);
    expect(input.scope.unreadOnly).toBe(true);
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
