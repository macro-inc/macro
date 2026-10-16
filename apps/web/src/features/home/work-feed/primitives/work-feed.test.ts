import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkFeedScope } from '../core/work-feed';
import { createFakeWorkFeedClient } from '../tests/fake-client';
import {
  documentEntry,
  invalidatedPatch,
  removedPatch,
  upsertedPatch,
  workFeedPage,
} from '../tests/wire';
import { createWorkFeed, WORK_FEED_RESUBSCRIBE_DELAY_MS } from './work-feed';

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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const SCOPE: WorkFeedScope = {
  mode: 'work',
  types: [],
  includeSnippets: false,
};

const docA = documentEntry({
  docId: 'doc-a',
  sortAt: '2026-02-01T10:09:00Z',
  attentionAt: '2026-02-01T10:09:00Z',
  stacks: [[{ id: 'n-a', createdAt: '2026-02-01T10:09:00Z' }]],
});
const docB = documentEntry({
  docId: 'doc-b',
  sortAt: '2026-02-01T10:05:00Z',
  primaryReason: 'OWN_WORK',
  touchedAt: '2026-02-01T10:05:00Z',
});

function setup(
  mutationData: Record<string, unknown> = {},
  options: { cache?: boolean } = {}
) {
  const fake = createFakeWorkFeedClient(mutationData);
  const revalidateNotifications = vi.fn(async () => {});
  let feed!: ReturnType<typeof createWorkFeed>;
  const dispose = createRoot((rootDispose) => {
    feed = createWorkFeed({
      client: () => fake.client,
      cacheHost: () => (options.cache === false ? undefined : fake.host),
      scope: () => SCOPE,
      enabled: () => true,
      revalidateNotifications,
    });
    return rootDispose;
  });
  disposals.push(dispose);
  const itemIds = () => feed.entries().map((entry) => entry.itemId);
  return { fake, feed, itemIds, revalidateNotifications };
}

const entityOf = (docId: string) =>
  ({ type: 'document', id: docId }) as EntityData;

const NETWORK_ONLY = 'network-only';
const WIRE_SCOPE = { mode: 'WORK', types: [], includeSnippets: false };
/** Let timers at zero and the cache's promise chains run out. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

const docC = documentEntry({
  docId: 'doc-c',
  sortAt: '2026-02-01T10:07:00Z',
  attentionAt: '2026-02-01T10:07:00Z',
});

describe('createWorkFeed', () => {
  it('writes live changes into the cached pages without a read', async () => {
    vi.useFakeTimers();
    const { fake, itemIds } = setup();
    await flush();

    expect(fake.queries[0].variables).toEqual({
      input: { scope: WIRE_SCOPE, limit: 50, cursor: null },
    });
    expect(fake.subscriptions[0].variables).toEqual({ scope: WIRE_SCOPE });

    fake.queries[0].resolve(workFeedPage([docA, docB]));
    await flush();
    expect(itemIds()).toEqual(['document:doc-a', 'document:doc-b']);

    const reads = fake.queries.length;
    fake.subscriptions[0].next({
      workFeedUpdates: [upsertedPatch(docC), removedPatch('document:doc-a')],
    });
    await flush();

    expect(fake.queries).toHaveLength(reads);
    expect(fake.writes).toHaveLength(1);
    expect(itemIds()).toEqual(['document:doc-c', 'document:doc-b']);
  });

  it('writes changes only after a page read in flight lands', async () => {
    vi.useFakeTimers();
    const { fake, feed, itemIds } = setup();
    await flush();
    fake.queries[0].resolve(workFeedPage([docA]));
    await flush();

    void feed.refetch();
    await flush();
    const read = fake.queries.at(-1);
    expect(read?.context.requestPolicy).toBe(NETWORK_ONLY);

    fake.subscriptions[0].next({ workFeedUpdates: [upsertedPatch(docC)] });
    await flush();
    expect(fake.writes).toHaveLength(0);

    read?.resolve(workFeedPage([docA, docB]));
    await flush();
    expect(fake.writes).toHaveLength(1);
    expect(itemIds()).toEqual([
      'document:doc-a',
      'document:doc-c',
      'document:doc-b',
    ]);
  });

  it('reads the feed again when the server invalidates it', async () => {
    vi.useFakeTimers();
    const { fake } = setup();
    await flush();
    fake.queries[0].resolve(workFeedPage([docA]));
    await flush();
    const reads = fake.queries.length;

    fake.subscriptions[0].next({ workFeedUpdates: [invalidatedPatch()] });
    await flush();

    expect(fake.queries).toHaveLength(reads + 1);
    expect(fake.queries.at(-1)?.context.requestPolicy).toBe(NETWORK_ONLY);
    expect(fake.writes).toHaveLength(0);
  });

  it('reads the feed again when there is no cache to write to', async () => {
    vi.useFakeTimers();
    const { fake } = setup({}, { cache: false });
    await flush();
    fake.queries[0].resolve(workFeedPage([docA]));
    await flush();
    const reads = fake.queries.length;

    fake.subscriptions[0].next({ workFeedUpdates: [upsertedPatch(docC)] });
    await flush();

    expect(fake.queries).toHaveLength(reads + 1);
    expect(fake.queries.at(-1)?.context.requestPolicy).toBe(NETWORK_ONLY);
  });

  it('marks rows done as feed items and undoes exactly that', async () => {
    vi.useFakeTimers();
    const { fake, feed, itemIds, revalidateNotifications } = setup({
      MarkWorkFeedItemsDone: {
        markWorkFeedItemsDone: {
          itemIds: ['document:doc-a'],
          undoToken: 'undo-1',
        },
      },
      UndoWorkFeedItemsDone: {
        undoWorkFeedItemsDone: { patches: [upsertedPatch(docA)] },
      },
    });
    await flush();
    fake.queries[0].resolve(workFeedPage([docA, docB]));
    await flush();

    expect(feed.markDone.prepare([entityOf('not-in-feed')])).toBeUndefined();
    const prepared = feed.markDone.prepare([entityOf('doc-a')]);
    if (!prepared) throw new Error('doc-a is a feed row');

    const show = prepared.hide();
    expect(itemIds()).toEqual(['document:doc-b']);

    const reads = fake.queries.length;
    const { undo } = await prepared.commit();
    expect(fake.mutations[0]).toEqual({
      name: 'MarkWorkFeedItemsDone',
      variables: {
        input: { items: [{ id: 'document:doc-a', revision: 'rev-doc-a' }] },
      },
    });
    expect(revalidateNotifications).toHaveBeenCalledTimes(1);

    // The server's removal arrives on the stream; the done needs no read.
    fake.subscriptions[0].next({
      workFeedUpdates: [removedPatch('document:doc-a')],
    });
    await flush();
    expect(fake.queries).toHaveLength(reads);
    expect(itemIds()).toEqual(['document:doc-b']);

    show();
    await undo();
    await flush();
    expect(fake.mutations[1]).toEqual({
      name: 'UndoWorkFeedItemsDone',
      variables: { input: { undoToken: 'undo-1', scope: WIRE_SCOPE } },
    });
    // The restored place lands with the undo, not with a read.
    expect(fake.queries).toHaveLength(reads);
    expect(itemIds()).toEqual(['document:doc-a', 'document:doc-b']);
  });

  it('keeps a done row hidden through a stale change, not a newer reason', async () => {
    vi.useFakeTimers();
    const { fake, feed, itemIds } = setup();
    await flush();
    fake.queries[0].resolve(workFeedPage([docA, docB]));
    await flush();

    feed.markDone.prepare([entityOf('doc-a')])?.hide();
    expect(itemIds()).toEqual(['document:doc-b']);

    // A change computed before the done still carries its revision.
    fake.subscriptions[0].next({ workFeedUpdates: [upsertedPatch(docA)] });
    await flush();
    expect(itemIds()).toEqual(['document:doc-b']);

    const reply = documentEntry({
      docId: 'doc-a',
      sortAt: '2026-02-01T10:30:00Z',
      attentionAt: '2026-02-01T10:30:00Z',
      revision: 'rev-doc-a-2',
    });
    fake.subscriptions[0].next({ workFeedUpdates: [upsertedPatch(reply)] });
    await flush();
    expect(itemIds()).toEqual(['document:doc-a', 'document:doc-b']);
  });

  it('shows a done row reopened with the reasons it acknowledged', async () => {
    vi.useFakeTimers();
    const { fake, feed, itemIds } = setup();
    await flush();
    fake.queries[0].resolve(workFeedPage([docA, docB]));
    await flush();

    feed.markDone.prepare([entityOf('doc-a')])?.hide();
    fake.subscriptions[0].next({
      workFeedUpdates: [removedPatch('document:doc-a')],
    });
    await flush();
    expect(itemIds()).toEqual(['document:doc-b']);

    // Marked not done elsewhere: the same notifications are back.
    fake.subscriptions[0].next({ workFeedUpdates: [upsertedPatch(docA)] });
    await flush();
    expect(itemIds()).toEqual(['document:doc-a', 'document:doc-b']);
  });

  it('resubscribes and reads again after the live stream ends', async () => {
    vi.useFakeTimers();
    const { fake } = setup();
    await flush();
    fake.queries[0].resolve(workFeedPage([docA]));
    await flush();

    fake.subscriptions[0].fail('work feed subscription ended');
    await vi.advanceTimersByTimeAsync(WORK_FEED_RESUBSCRIBE_DELAY_MS - 1);
    expect(fake.subscriptions).toHaveLength(1);

    const reads = fake.queries.length;
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fake.subscriptions).toHaveLength(2);
    expect(fake.queries).toHaveLength(reads + 1);
    expect(fake.queries.at(-1)?.context.requestPolicy).toBe(NETWORK_ONLY);
  });
});

describe('createWorkFeed done on own work', () => {
  const mixed = documentEntry({
    docId: 'mixed',
    sortAt: '2026-02-01T10:20:00Z',
    primaryReason: 'OWN_WORK',
    attentionAt: '2026-02-01T10:02:00Z',
    touchedAt: '2026-02-01T10:20:00Z',
    stacks: [[{ id: 'n-mixed', createdAt: '2026-02-01T10:02:00Z' }]],
  });

  it('completes only rows with attention and keeps rows with own work', async () => {
    const { fake, feed, itemIds } = setup({
      MarkWorkFeedItemsDone: {
        markWorkFeedItemsDone: {
          itemIds: ['document:mixed'],
          undoToken: 'undo-mixed',
        },
      },
    });
    await settle();
    fake.queries[0].resolve(workFeedPage([mixed, docA, docB]));
    await settle();

    // docB is own work alone: nothing to complete.
    expect(feed.markDone.canComplete(entityOf('doc-b'))).toBe(false);
    expect(feed.markDone.prepare([entityOf('doc-b')])).toBeUndefined();
    expect(feed.markDone.canComplete(entityOf('mixed'))).toBe(true);
    expect(feed.markDone.canComplete(entityOf('elsewhere'))).toBeUndefined();

    const prepared = feed.markDone.prepare([
      entityOf('mixed'),
      entityOf('doc-a'),
      entityOf('doc-b'),
    ]);
    if (!prepared) throw new Error('mixed and doc-a have attention');
    prepared.hide();
    // doc-a leaves; the row the viewer also worked on stays.
    expect(itemIds()).toEqual(['document:mixed', 'document:doc-b']);

    await prepared.commit();
    expect(fake.mutations[0].variables).toEqual({
      input: {
        items: [
          { id: 'document:mixed', revision: 'rev-mixed' },
          { id: 'document:doc-a', revision: 'rev-doc-a' },
        ],
      },
    });
  });
});
