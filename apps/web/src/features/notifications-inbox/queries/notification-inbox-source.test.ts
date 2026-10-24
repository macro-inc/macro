import { createFakeAttentionFeedClient } from '@queries/attention-feed/tests/fake-client';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxFeedSource } from '../context/notifications-inbox-context';
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

function setup(mutationData: Record<string, unknown> = {}) {
  const fake = createFakeAttentionFeedClient(mutationData);
  const revalidateNotifications = vi.fn(async () => {});
  const restoreNotifications = vi.fn();
  const overrideNotificationsDone = vi.fn(() => restoreNotifications);
  let feed!: InboxFeedSource;
  const dispose = createRoot((rootDispose) => {
    feed = createNotificationInboxSource({
      client: () => fake.client,
      cacheHost: () => fake.host,
      scope: () => ({ rowTypes: ALL_INBOX_ROW_TYPES }),
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

  it('reads the row as unseen again when marking it seen fails', async () => {
    vi.useFakeTimers();
    const { feed, row } = await loaded();

    await expect(
      feed.markSeen([row('document:doc-a#top_level')])
    ).rejects.toThrow();

    expect(row('document:doc-a#top_level').unseen).toBe(true);
  });
});
