import { createThreadPaginator } from '@app/features/channel/Channel/thread-paginator';
import { fireAndForget } from '@core/util/fireAndForget';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import type {
  CacheRevision,
  ChannelTimelineCacheArgs,
  ChannelTimelineCacheResult,
} from '@graphql-cache/index';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { until } from '@solid-primitives/promise';
import { onlineManager } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  channelMessageKey,
  mapChannelTimelineEntry,
  rootSortKey,
} from '../channel-map';
import type * as ChannelNetwork from '../channel-network';
import type {
  ChannelPageEntry,
  FetchChannelServerPage,
} from '../channel-pages';
import { createChannelTouches } from '../channel-pages';
import { whileNoFills } from '../channel-resets';
import type { ChannelChange } from '../channel-sync-runtime';
import {
  type ChannelTimelineRuntime,
  type ChannelWindows,
  createChannelWindows,
  createLocalChannelTimeline,
  type LocalChannelTimeline,
  PAGE_RETRY_MS,
} from '../channel-timeline';
import { fakeLocks } from './fake-locks';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage as fixtureMessage,
  keyOf,
} from './fixtures';

vi.mock('../channel-network', async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelNetwork>()),
  queryChannelNetwork: () => {
    throw new Error('tests pass fetchPage');
  },
}));

type Row = ChannelMessageFieldsFragment;

/** A root created `n` seconds into the fixture hour, for any `n` under 3600. */
function graphqlMessage(n: number): Row {
  const base = fixtureMessage(n);
  const minutes = String(Math.floor(n / 60)).padStart(2, '0');
  const seconds = String(n % 60).padStart(2, '0');
  const createdAt = `2026-11-01T10:${minutes}:${seconds}.000123Z`;
  return {
    ...base,
    createdAt,
    updatedAt: createdAt,
    thread: base.thread && { ...base.thread, createdAt, updatedAt: createdAt },
    sortKey: rootSortKey(createdAt, base.id) ?? '',
  };
}

/**
 * Answers reads the way the engine does over one stretch held from the start
 * of the channel to its live end: strict cursors, an `around` split, and the
 * cursors' null edges.
 */
function windowOver(rows: () => Row[], held: () => boolean) {
  return (args: ChannelTimelineCacheArgs): ChannelTimelineCacheResult => {
    const base = {
      kind: 'page' as const,
      revision: '1' as CacheRevision,
      seq: '7',
      optimistic: false,
    };
    const miss = {
      ...base,
      covered: false,
      keys: [],
      olderCursor: null,
      newerCursor: null,
    };
    if (!held()) return miss;
    const sorted = [...rows()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    let older: Row[];
    let newer: Row[];
    let anchor: Row | undefined;
    let olderLimit = args.limit;
    let newerLimit = 0;
    if (args.around !== undefined) {
      anchor = sorted.find((row) => keyOf(row) === args.around);
      if (!anchor) return miss;
      const position = anchor.sortKey;
      older = sorted.filter((row) => row.sortKey < position).reverse();
      newer = sorted.filter((row) => row.sortKey > position);
      olderLimit = Math.floor(args.limit / 2);
      newerLimit = args.limit - olderLimit - 1;
    } else if (args.after !== undefined) {
      const after = args.after;
      older = [];
      newer = sorted.filter((row) => row.sortKey > after);
      olderLimit = 0;
      newerLimit = args.limit;
    } else {
      const before = args.before;
      older = sorted
        .filter((row) => before === undefined || row.sortKey < before)
        .reverse();
      newer = [];
    }
    const moreOlder = older.length > olderLimit;
    const moreNewer = newer.length > newerLimit;
    older = older.slice(0, olderLimit);
    newer = newer.slice(0, newerLimit);
    const page = [...newer.reverse(), ...(anchor ? [anchor] : []), ...older];
    if (anchor === undefined && page.length === 0 && moreOlder) return miss;
    const oldest = page.at(-1)?.sortKey ?? args.before ?? args.after ?? '';
    const newest = page[0]?.sortKey ?? args.before ?? args.after ?? '';
    return {
      ...base,
      covered: true,
      keys: page.map(keyOf),
      olderCursor: args.after !== undefined || moreOlder ? oldest : null,
      newerCursor:
        args.before !== undefined ||
        ((args.around !== undefined || args.after !== undefined) && moreNewer)
          ? newest
          : null,
    };
  };
}

function fakeRuntime() {
  const listeners = new Set<(change: ChannelChange) => void>();
  const runtime: ChannelTimelineRuntime & {
    changed(): void;
    resumed(): void;
  } = {
    open: vi.fn(() => () => {}),
    onChanged: vi.fn(
      (_channelId: string, listener: (change: ChannelChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    ),
    noteStoredSeq: vi.fn(),
    noteServerRead: vi.fn(),
    ensureCurrent: vi.fn(async () => 'current' as const),
    epoch: () => 3,
    changed: () => {
      for (const listener of listeners) listener('changed');
    },
    resumed: () => {
      for (const listener of listeners) listener('resumed');
    },
  };
  return runtime;
}

const messages = (count: number) =>
  Array.from({ length: count }, (_, index) => graphqlMessage(index + 1));

const ids = (timeline: LocalChannelTimeline) =>
  timeline
    .entries()
    .map((entry) => (entry.type === 'activity' ? '' : entry.message.id));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await settle();
  }
  throw new Error('condition never held');
}

function mount(options: {
  rows: Row[];
  held?: boolean;
  fetchPage?: FetchChannelServerPage;
  around?: string;
  unstored?: () => ChannelPageEntry[];
  windows?: ChannelWindows;
}) {
  const [rows, setRows] = createSignal(options.rows);
  const [held, setHeld] = createSignal(options.held ?? true);
  const host = fakeHost(windowOver(rows, held), { records: options.rows });
  const runtime = fakeRuntime();
  const onUnsupported = vi.fn();
  const [around, setAround] = createSignal<string | null | undefined>(
    options.around
  );
  let dispose = () => {};
  const timeline = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createLocalChannelTimeline(
      {
        host,
        runtime,
        touches: createChannelTouches(),
        fetchPage: options.fetchPage,
        unstored: options.unstored,
        windows: options.windows,
      },
      CHANNEL_ID,
      around,
      onUnsupported
    );
  });
  const addRow = (row: Row) => {
    host.records.set(keyOf(row), row);
    setRows([...rows(), row]);
  };
  return {
    timeline,
    host,
    runtime,
    onUnsupported,
    setHeld,
    setAround,
    addRow,
    dispose,
  };
}

describe('createLocalChannelTimeline', () => {
  it('opens a held channel from the device without asking the server', async () => {
    const fetchPage = vi.fn<FetchChannelServerPage>();
    const { timeline, runtime, host, dispose } = mount({
      rows: messages(3),
      fetchPage,
    });
    await waitFor(() => !timeline.isLoading());

    expect(ids(timeline)).toEqual(
      messages(3)
        .reverse()
        .map((row) => row.id)
    );
    expect(timeline.hasOlder()).toBe(false);
    expect(timeline.hasNewer()).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    await waitFor(() => vi.mocked(runtime.ensureCurrent).mock.calls.length > 0);
    expect(runtime.noteStoredSeq).toHaveBeenCalledWith(CHANNEL_ID, '7');
    expect(runtime.open).toHaveBeenCalledWith(CHANNEL_ID);
    // One touch, no other write.
    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID, touchedAtMs: expect.any(Number) },
    ]);
    dispose();
  });

  it('shows a root this page sent at the live end until the device holds it', async () => {
    const sent = graphqlMessage(9);
    const entry = mapChannelTimelineEntry(sent);
    if (!entry) throw new Error('not a row');
    const [unstored, setUnstored] = createSignal<ChannelPageEntry[]>([
      { key: channelMessageKey(sent.id), sortKey: sent.sortKey, entry },
    ]);
    const { timeline, runtime, addRow, dispose } = mount({
      rows: messages(2),
      unstored,
    });
    await waitFor(() => !timeline.isLoading());
    expect(ids(timeline)).toEqual([
      sent.id,
      graphqlMessage(2).id,
      graphqlMessage(1).id,
    ]);

    // The device stores it: its copy replaces the one in hand.
    addRow(sent);
    runtime.changed();
    await settle();
    setUnstored([]);
    await waitFor(() => timeline.entries()[0] !== entry);
    expect(ids(timeline)).toEqual([
      sent.id,
      graphqlMessage(2).id,
      graphqlMessage(1).id,
    ]);
    dispose();
  });

  it('reads the window once when the view sets no target again as it mounts', async () => {
    const { timeline, host, setAround, dispose } = mount({ rows: messages(3) });
    setAround(null);
    await waitFor(() => !timeline.isLoading());
    await settle();
    expect(host.reads).toHaveLength(1);
    dispose();
  });

  it('reads the window again when the runtime reports a change, keeping unchanged entries', async () => {
    const { timeline, runtime, addRow, dispose } = mount({
      rows: messages(3),
    });
    await waitFor(() => !timeline.isLoading());
    const before = timeline.entries()[0];

    addRow(graphqlMessage(4));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 4);

    expect(ids(timeline)[0]).toBe(graphqlMessage(4).id);
    expect(timeline.entries()[1]).toBe(before);
    dispose();
  });

  it('pages older entries from the device and stops at the first', async () => {
    const { timeline, dispose } = mount({ rows: messages(70) });
    await waitFor(() => !timeline.isLoading());
    expect(timeline.entries()).toHaveLength(50);
    expect(timeline.hasOlder()).toBe(true);

    await timeline.loadOlder();

    expect(timeline.entries()).toHaveLength(70);
    expect(timeline.hasOlder()).toBe(false);
    expect(ids(timeline).at(-1)).toBe(graphqlMessage(1).id);
    dispose();
  });

  it('pages older entries again once the connection is back after a page failed with none', async () => {
    const rows = messages(70);
    let connected = false;
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
      if (!connected) throw new TypeError('Failed to fetch');
      return {
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: rows.slice(0, 20).reverse(),
          olderCursor: null,
          newerCursor: null,
          seq: '9',
        } as never,
        cached: Promise.resolve(),
      };
    });
    const mounted = mount({ rows, fetchPage });
    await waitFor(() => !mounted.timeline.isLoading());
    expect(mounted.timeline.entries()).toHaveLength(50);
    // The device holds only the latest fifty.
    mounted.setHeld(false);
    onlineManager.setOnline(false);
    try {
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(50);

      // Scrolled to the top there is no next scroll to ask again.
      connected = true;
      onlineManager.setOnline(true);
      await waitFor(() => mounted.timeline.entries().length === 70);
      mounted.dispose();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('stops an older page’s server request when the view closes', async () => {
    const rows = messages(70);
    let sent: AbortSignal | undefined;
    const fetchPage = vi.fn<FetchChannelServerPage>(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          sent = signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        })
    );
    const mounted = mount({ rows, fetchPage });
    await waitFor(() => !mounted.timeline.isLoading());
    // The device no longer holds the older entries.
    mounted.setHeld(false);
    const loading = mounted.timeline.loadOlder();
    await waitFor(() => fetchPage.mock.calls.length === 1);

    mounted.dispose();

    expect(sent?.aborted).toBe(true);
    await loading;
  });

  it('lets older pages load again after the window is read again under a new session', async () => {
    const rows = messages(70);
    let failStore!: (error: unknown) => void;
    let olderSignal: AbortSignal | undefined;
    const firstStored = new Promise<void>((_resolve, reject) => {
      failStore = reject;
    });
    let windowReads = 0;
    const fetchPage = vi.fn<FetchChannelServerPage>((input, signal) => {
      if (input.before) {
        olderSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      windowReads += 1;
      return Promise.resolve({
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: rows.slice(-50).reverse(),
          olderCursor: rows[20]!.sortKey,
          newerCursor: null,
          seq: '9',
        } as never,
        cached: windowReads === 1 ? firstStored : Promise.resolve(),
      });
    });
    const { timeline, dispose } = mount({ rows, held: false, fetchPage });
    await waitFor(() => !timeline.isLoading() && timeline.hasOlder());
    // Scrolled back while the first window is still being stored.
    const older = timeline.loadOlder();
    await waitFor(() => olderSignal !== undefined);
    expect(timeline.isLoadingOlder()).toBe(true);

    failStore(new StaleCacheAuthorityError());
    await waitFor(() => olderSignal?.aborted === true && windowReads === 2);
    await older;
    await settle();

    expect(timeline.hasOlder()).toBe(true);
    expect(timeline.isLoadingOlder()).toBe(false);
    dispose();
  });

  it('pages from the new window, not the old one, once a window is read again', async () => {
    const rows = messages(71);
    const firstStore = Promise.withResolvers<void>();
    const oldPageStarted = Promise.withResolvers<void>();
    const reloadStarted = Promise.withResolvers<void>();
    const reload =
      Promise.withResolvers<Awaited<ReturnType<FetchChannelServerPage>>>();
    const secondPage = Promise.withResolvers<void>();
    const page = (
      entries: Row[],
      olderCursor: string | null,
      cached: Promise<void>
    ) => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [...entries].reverse(),
        olderCursor,
        newerCursor: null,
        seq: '9',
      } as never,
      cached,
    });
    let olderReads = 0;
    let windowReads = 0;
    const fetchPage = vi.fn<FetchChannelServerPage>(async (input, signal) => {
      if (input.before) {
        olderReads++;
        if (olderReads === 1) {
          oldPageStarted.resolve();
          return new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            })
          );
        }
        const older = rows.filter((row) => row.sortKey < input.before!);
        await secondPage.promise;
        return page(older, null, Promise.resolve());
      }
      windowReads++;
      if (windowReads === 1) {
        return page(rows.slice(20, 70), rows[20]!.sortKey, firstStore.promise);
      }
      reloadStarted.resolve();
      return reload.promise;
    });
    const { timeline, dispose } = mount({ rows, held: false, fetchPage });
    try {
      await waitFor(() => timeline.hasOlder());
      const oldLoad = timeline.loadOlder();
      await oldPageStarted.promise;
      firstStore.reject(new StaleCacheAuthorityError());
      await reloadStarted.promise;
      await oldLoad;
      const newLoad = timeline.loadOlder();
      reload.resolve(
        page(rows.slice(21), rows[21]!.sortKey, Promise.resolve())
      );
      await waitFor(() => ids(timeline)[0] === rows[70]!.id);
      secondPage.resolve();
      await newLoad;
      expect(timeline.hasOlder() || ids(timeline).includes(rows[20]!.id)).toBe(
        true
      );
    } finally {
      dispose();
    }
  });

  it('keeps every paged entry through a reread', async () => {
    const { timeline, runtime, addRow, dispose } = mount({
      rows: messages(70),
    });
    await waitFor(() => !timeline.isLoading());
    await timeline.loadOlder();

    addRow(graphqlMessage(71));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 71);

    expect(timeline.hasOlder()).toBe(false);
    expect(ids(timeline)[0]).toBe(graphqlMessage(71).id);
    expect(ids(timeline).at(-1)).toBe(graphqlMessage(1).id);
    dispose();
  });

  it('keeps a page paged in while a reread was reading', async () => {
    const { timeline, runtime, host, dispose } = mount({
      rows: messages(70),
    });
    await waitFor(() => !timeline.isLoading());

    // The reread reads the 50 entries shown; the older page lands first.
    const read = host.channelTimeline;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    host.channelTimeline = async (args) => {
      if (first) {
        first = false;
        await held;
      }
      return read(args);
    };
    runtime.changed();
    await timeline.loadOlder();
    release();
    for (let i = 0; i < 20; i += 1) await settle();

    expect(timeline.entries()).toHaveLength(70);
    expect(timeline.hasOlder()).toBe(false);
    dispose();
  });

  it('fetches a channel the device does not hold and follows it once stored', async () => {
    const rows = messages(2);
    let held = false;
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [...rows].reverse(),
        olderCursor: null,
        newerCursor: null,
        seq: '9',
      } as never,
      cached: (async () => {
        held = true;
      })(),
    }));
    const mounted = mount({ rows, held: false, fetchPage });
    const { timeline, runtime } = mounted;
    await waitFor(() => !timeline.isLoading());
    expect(ids(timeline)).toEqual([rows[1]!.id, rows[0]!.id]);
    mounted.setHeld(held);
    await waitFor(
      () => vi.mocked(runtime.noteServerRead).mock.calls.length > 0
    );
    expect(runtime.noteServerRead).toHaveBeenCalledWith(
      CHANNEL_ID,
      '9',
      3,
      '9'
    );
    expect(mounted.host.commits.at(-1)).toMatchObject({
      channelId: CHANNEL_ID,
      coverage: [{ start: '', end: '\u{10FFFF}' }],
      seq: { kind: 'lower', seq: '9' },
    });

    mounted.addRow(graphqlMessage(3));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 3);
    mounted.dispose();
  });

  it('reads a page again when the cache session changed before it was stored, keeping it shown', async () => {
    const rows = messages(2);
    let held = false;
    let calls = 0;
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
      calls += 1;
      const first = calls === 1;
      return {
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: [...rows].reverse(),
          olderCursor: null,
          newerCursor: null,
          seq: '9',
        } as never,
        cached: (async () => {
          if (first) throw new StaleCacheAuthorityError();
          held = true;
        })(),
      };
    });
    const mounted = mount({ rows, held: false, fetchPage });
    const { timeline, runtime } = mounted;
    const shown: number[] = [];
    await waitFor(() => {
      shown.push(timeline.entries().length);
      return vi.mocked(runtime.noteServerRead).mock.calls.length > 0;
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(runtime.noteServerRead).toHaveBeenCalledWith(
      CHANNEL_ID,
      '9',
      3,
      '9'
    );
    // The reload never blanks the window it shows.
    expect(shown.slice(shown.indexOf(2))).not.toContain(0);

    mounted.setHeld(held);
    mounted.addRow(graphqlMessage(3));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 3);
    mounted.dispose();
  });

  it('holds a window opened while the cache was away once it serves again, keeping it shown', async () => {
    const rows = messages(2);
    let away = true;
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [...rows].reverse(),
        olderCursor: null,
        newerCursor: null,
        seq: '9',
      } as never,
      cached: away
        ? Promise.reject(new Error('cache is away'))
        : Promise.resolve(),
    }));
    const mounted = mount({ rows, held: false, fetchPage });
    const { timeline, runtime } = mounted;
    await waitFor(() => timeline.entries().length === 2);
    await settle();
    // Not held: a change reported meanwhile cannot be read.
    runtime.changed();
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    away = false;
    const shown: number[] = [];
    runtime.resumed();
    await waitFor(() => {
      shown.push(timeline.entries().length);
      return vi.mocked(runtime.noteServerRead).mock.calls.length > 1;
    });
    expect(shown).not.toContain(0);

    mounted.setHeld(true);
    mounted.addRow(graphqlMessage(3));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 3);
    mounted.dispose();
  });

  it('holds a window still loading when the cache serves again', async () => {
    const rows = messages(2);
    const page = (cached: Promise<void>) => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [...rows].reverse(),
        olderCursor: null,
        newerCursor: null,
        seq: '9',
      } as never,
      cached,
    });
    const unstored = Promise.withResolvers<ReturnType<typeof page>>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockReturnValueOnce(unstored.promise)
      .mockResolvedValue(page(Promise.resolve()));
    const mounted = mount({ rows, held: false, fetchPage });
    const { timeline, runtime } = mounted;
    await waitFor(() => fetchPage.mock.calls.length === 1);

    runtime.resumed();
    await waitFor(() => timeline.entries().length === 2);
    // Read while the cache was away, and stored by nothing.
    const lost = Promise.reject(new Error('cache is away'));
    unstored.resolve(page(lost));
    await settle();

    mounted.setHeld(true);
    mounted.addRow(graphqlMessage(3));
    runtime.changed();
    await waitFor(() => timeline.entries().length === 3);
    mounted.dispose();
  });

  it('holds its window again when a page an outage lost fails to store after it', async () => {
    const [first, latest, added] = messages(3) as [Row, Row, Row];
    let keys = [keyOf(latest)];
    let away = false;
    const host = fakeHost(
      (args) => {
        if (away) throw new Error('cache is away');
        if (args.before !== undefined) return devicePage([keyOf(first)]);
        return devicePage(keys, { olderCursor: latest.sortKey });
      },
      { records: [first, latest, added] }
    );
    const stored = Promise.withResolvers<void>();
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [first],
        olderCursor: null,
        newerCursor: first.sortKey,
        seq: '7',
      } as never,
      cached: stored.promise,
    }));
    const runtime = fakeRuntime();
    const { timeline, dispose } = createRoot((dispose) => ({
      dispose,
      timeline: createLocalChannelTimeline(
        { host, runtime, touches: createChannelTouches(), fetchPage },
        CHANNEL_ID,
        () => undefined,
        vi.fn()
      ),
    }));
    await waitFor(() => vi.mocked(runtime.noteStoredSeq).mock.calls.length > 0);
    away = true;
    const page = timeline.loadOlder();
    await waitFor(() => timeline.entries().length === 2);

    // The outage ends while the page is storing, and the store is lost to it.
    away = false;
    runtime.resumed();
    stored.reject(new Error('cache was away'));
    await page;
    keys = [keyOf(added), keyOf(latest)];
    runtime.changed();
    await waitFor(() => ids(timeline)[0] === added.id);
    dispose();
  });

  it('reads a held window again once the cache serves again', async () => {
    const { timeline, runtime, addRow, dispose } = mount({ rows: messages(2) });
    await waitFor(() => !timeline.isLoading());
    await settle();
    addRow(graphqlMessage(3));
    runtime.resumed();
    await waitFor(() => timeline.entries().length === 3);
    dispose();
  });

  it('reads a page again once a delete in another tab is done, holding it then', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    try {
      let finishDelete!: () => void;
      const deleting = whileNoFills(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve;
          }),
        { waitMs: 60_000 }
      );
      const rows = messages(2);
      const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: [...rows].reverse(),
          olderCursor: null,
          newerCursor: null,
          seq: '9',
        } as never,
        cached: Promise.resolve(),
      }));
      const mounted = mount({ rows, held: false, fetchPage });
      await waitFor(() => mounted.timeline.entries().length === 2);
      await settle();
      // Shown, but neither covered nor followed while the delete may take it.
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(mounted.host.commits).toEqual([]);
      expect(mounted.runtime.noteServerRead).not.toHaveBeenCalled();

      finishDelete();
      await deleting;
      await waitFor(
        () => vi.mocked(mounted.runtime.noteServerRead).mock.calls.length > 0
      );
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(mounted.host.commits).toHaveLength(1);
      expect(mounted.timeline.entries()).toHaveLength(2);
      mounted.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads an older page again once a delete in another tab is done, holding it then', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    try {
      const rows = messages(70);
      const older = rows.slice(0, 20).reverse();
      const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: older,
          olderCursor: 'past-the-page',
          newerCursor: null,
          seq: '9',
        } as never,
        cached: Promise.resolve(),
      }));
      const mounted = mount({ rows, fetchPage });
      await waitFor(() => !mounted.timeline.isLoading());
      // The device no longer holds the older entries.
      mounted.setHeld(false);
      let finishDelete!: () => void;
      const deleting = whileNoFills(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve;
          }),
        { waitMs: 60_000 }
      );

      const loading = mounted.timeline.loadOlder();
      // Shown, but not covered while the delete may take it.
      await waitFor(() => mounted.timeline.entries().length === 70);
      const covered = () =>
        mounted.host.commits.filter((commit) => commit.coverage);
      expect(covered()).toEqual([]);
      // A second scroll waits for the page still to be read again, rather
      // than reading past it unheld.
      expect(mounted.timeline.isLoadingOlder()).toBe(true);
      await mounted.timeline.loadOlder();
      expect(fetchPage).toHaveBeenCalledTimes(1);

      finishDelete();
      await deleting;
      await loading;
      await waitFor(() => covered().length > 0);
      // The same older page, read again and covered this time.
      expect(fetchPage.mock.calls[1]?.[0]).toEqual(
        fetchPage.mock.calls[0]?.[0]
      );
      expect(fetchPage.mock.calls[0]?.[0]).toHaveProperty('before');
      mounted.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a missing target from the server', async () => {
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
      throw new CombinedError({
        graphQLErrors: [
          {
            message: 'message or parent not found',
            extensions: { code: 'NOT_FOUND' },
          },
        ],
      });
    });
    const { timeline, dispose } = mount({
      rows: messages(2),
      held: false,
      fetchPage,
      around: 'gone-message',
    });
    await waitFor(() => !timeline.isLoading());

    expect(timeline.isMissingTarget()).toBe(true);
    expect(timeline.loadError()).toBe('NOT_FOUND');
    dispose();
  });

  it('loads a window that failed with no connection again once it is back', async () => {
    const rows = messages(2);
    let connected = false;
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => {
      if (!connected) throw new TypeError('Failed to fetch');
      return {
        page: {
          __typename: 'GraphqlChannelTimelinePage',
          entries: [...rows].reverse(),
          olderCursor: null,
          newerCursor: null,
          seq: '9',
        } as never,
        cached: Promise.resolve(),
      };
    });
    onlineManager.setOnline(false);
    try {
      const { timeline, dispose } = mount({ rows, held: false, fetchPage });
      await waitFor(() => timeline.loadError() !== undefined);

      // Nothing on screen to press: the connection coming back loads it.
      connected = true;
      onlineManager.setOnline(true);
      await waitFor(() => timeline.entries().length === 2);
      expect(timeline.loadError()).toBeUndefined();
      dispose();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('hands an unsupported host back to REST', async () => {
    const host = fakeHost(() => ({ kind: 'unsupported' }));
    const onUnsupported = vi.fn();
    const dispose = createRoot((disposeRoot) => {
      createLocalChannelTimeline(
        { host, runtime: fakeRuntime(), touches: createChannelTouches() },
        CHANNEL_ID,
        () => undefined,
        onUnsupported
      );
      return disposeRoot;
    });
    await waitFor(() => onUnsupported.mock.calls.length > 0);
    dispose();
  });

  it('loads around a target and then back to the live end', async () => {
    const rows = messages(80);
    const { timeline, setAround, dispose } = mount({
      rows,
      around: rows[10]!.id,
    });
    await waitFor(() => !timeline.isLoading());
    expect(ids(timeline)).toContain(rows[10]!.id);
    expect(timeline.hasNewer()).toBe(true);

    setAround(undefined);
    await timeline.toLatest();

    expect(timeline.hasNewer()).toBe(false);
    expect(ids(timeline)[0]).toBe(rows[79]!.id);
    dispose();
  });

  describe('mounted again (another tab and back)', () => {
    it('shows the window it left at once, then follows the device', async () => {
      const windows = createChannelWindows();
      const rows = messages(70);
      const first = mount({ rows, windows });
      await waitFor(() => !first.timeline.isLoading());
      await first.timeline.loadOlder();
      expect(first.timeline.entries()).toHaveLength(70);
      first.dispose();

      const fetchPage = vi.fn<FetchChannelServerPage>();
      const second = mount({
        rows: [...rows, graphqlMessage(71)],
        windows,
        fetchPage,
      });
      // Before any read: the list restores its scroll position over it.
      expect(second.timeline.isLoading()).toBe(false);
      expect(second.timeline.entries()).toHaveLength(70);
      expect(second.timeline.hasOlder()).toBe(false);

      // Then reads the device again and asks the server only if behind.
      await waitFor(() => second.timeline.entries().length === 71);
      expect(ids(second.timeline)[0]).toBe(graphqlMessage(71).id);
      expect(ids(second.timeline).at(-1)).toBe(graphqlMessage(1).id);
      await waitFor(
        () => vi.mocked(second.runtime.ensureCurrent).mock.calls.length > 0
      );
      expect(fetchPage).not.toHaveBeenCalled();
      second.dispose();
    });

    it('opens at the live end when it left a window around a target', async () => {
      const windows = createChannelWindows();
      const rows = messages(80);
      const first = mount({ rows, windows, around: rows[10]!.id });
      await waitFor(() => !first.timeline.isLoading());
      first.dispose();

      const second = mount({ rows, windows });
      expect(second.timeline.isLoading()).toBe(true);
      await waitFor(() => !second.timeline.isLoading());
      expect(ids(second.timeline)[0]).toBe(rows[79]!.id);
      expect(second.timeline.hasNewer()).toBe(false);
      second.dispose();
    });

    it('opens around a target rather than the window it left', async () => {
      const windows = createChannelWindows();
      const rows = messages(80);
      const first = mount({ rows, windows });
      await waitFor(() => !first.timeline.isLoading());
      first.dispose();

      const second = mount({ rows, windows, around: rows[10]!.id });
      expect(second.timeline.isLoading()).toBe(true);
      await waitFor(() => !second.timeline.isLoading());
      expect(ids(second.timeline)).toContain(rows[10]!.id);
      second.dispose();
    });

    it('keeps only the most recent channels it left', () => {
      const windows = createChannelWindows(2);
      const window = { entries: [], olderCursor: null };
      windows.keep('a', window);
      windows.keep('b', window);
      windows.keep('a', window);
      windows.keep('c', window);
      expect(windows.take('b')).toBeUndefined();
      expect(windows.take('a')).toBe(window);
      // Taken once: a second mount of the same channel reads it fresh.
      expect(windows.take('a')).toBeUndefined();
      expect(windows.take('c')).toBe(window);
      windows.keep('d', window);
      windows.clear();
      expect(windows.take('d')).toBeUndefined();
    });
  });
});

describe('createLocalChannelTimeline when the connection comes back', () => {
  type ServerPage = Awaited<ReturnType<FetchChannelServerPage>>;
  /** The server's page of `rows` from `from` to before `to`, oldest last. */
  const serverPage = (
    rows: Row[],
    from: number,
    to: number,
    cached: Promise<void> = Promise.resolve()
  ): ServerPage => ({
    page: {
      __typename: 'GraphqlChannelTimelinePage',
      entries: rows.slice(from, to).reverse(),
      olderCursor: from > 0 ? rows[from]!.sortKey : null,
      newerCursor: null,
      seq: '9',
    } as never,
    cached,
  });
  /** A mounted timeline's first window, read and settled on the device. */
  const settledOnDevice = (runtime: ChannelTimelineRuntime) => {
    const current = Promise.withResolvers<void>();
    vi.mocked(runtime.ensureCurrent).mockImplementationOnce(async () => {
      current.resolve();
      return 'current';
    });
    return current.promise;
  };

  it('loads a window again when the connection came back before its request failed', async () => {
    const rows = messages(2);
    const asked = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementationOnce(() => {
        asked.resolve();
        return pending.promise;
      })
      .mockResolvedValueOnce(serverPage(rows, 0, 2));
    onlineManager.setOnline(false);
    const mounted = mount({ rows, held: false, fetchPage });
    try {
      await asked.promise;
      // Back while the request sent with no connection is still out.
      onlineManager.setOnline(true);
      pending.reject(new TypeError('Failed to fetch'));

      await until(() => mounted.timeline.entries().length === 2);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('shows a window loading while the load after its failure is out', async () => {
    const rows = messages(2);
    const asked = Promise.withResolvers<void>();
    const askedAgain = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<ServerPage>();
    const again = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementationOnce(() => {
        asked.resolve();
        return pending.promise;
      })
      .mockImplementationOnce(() => {
        askedAgain.resolve();
        return again.promise;
      });
    onlineManager.setOnline(false);
    const mounted = mount({ rows, held: false, fetchPage });
    try {
      await asked.promise;
      onlineManager.setOnline(true);
      pending.reject(new TypeError('Failed to fetch'));
      await askedAgain.promise;

      expect(mounted.timeline.isLoading()).toBe(true);
      expect(mounted.timeline.loadError()).toBeUndefined();
      again.resolve(serverPage(rows, 0, 2));
      await until(() => mounted.timeline.entries().length === 2);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('keeps the live end a view moved to from a missing target when the connection comes back', async () => {
    const rows = messages(2);
    const fetchPage = vi.fn<FetchChannelServerPage>().mockRejectedValue(
      new CombinedError({
        graphQLErrors: [{ message: 'gone', extensions: { code: 'NOT_FOUND' } }],
      })
    );
    onlineManager.setOnline(false);
    const mounted = mount({ rows, around: 'gone', fetchPage });
    // As the channel view does: a missing target shows the live end.
    const disposeView = createRoot((dispose) => {
      createEffect(() => {
        if (mounted.timeline.isMissingTarget()) mounted.setAround(undefined);
      });
      return dispose;
    });
    try {
      await until(() => mounted.timeline.entries().length === 2);
      expect(fetchPage).toHaveBeenCalledTimes(1);

      // A load starts in the same turn as the connection comes back.
      onlineManager.setOnline(true);
      expect(mounted.timeline.isLoading()).toBe(false);
      expect(mounted.timeline.entries()).toHaveLength(2);
    } finally {
      disposeView();
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('pages no further when the connection comes back after a retried page loaded', async () => {
    const rows = messages(120);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(serverPage(rows, 20, 70));
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      onlineManager.setOnline(false);
      await mounted.timeline.loadOlder();
      // A scroll asks again, and gets the page.
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(100);

      // A page load starts in the same turn as the connection comes back.
      onlineManager.setOnline(true);
      expect(mounted.timeline.isLoadingOlder()).toBe(false);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('stops watching the connection once a page loads', async () => {
    const rows = messages(70);
    const subscribe = onlineManager.subscribe.bind(onlineManager);
    const unsubscribed: ReturnType<typeof vi.fn>[] = [];
    const subscriptions = vi
      .spyOn(onlineManager, 'subscribe')
      .mockImplementation((listener) => {
        const unsubscribe = vi.fn(subscribe(listener));
        unsubscribed.push(unsubscribe);
        return unsubscribe;
      });
    const mounted = mount({ rows });
    try {
      await settledOnDevice(mounted.runtime);
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(70);

      // One watch for the window and one for the page, both ended.
      expect(unsubscribed).toHaveLength(2);
      expect(unsubscribed[0]).toHaveBeenCalled();
      expect(unsubscribed[1]).toHaveBeenCalled();
    } finally {
      mounted.dispose();
      subscriptions.mockRestore();
    }
  });

  it('reads a page the device did not take again from its own cursor when the connection comes back', async () => {
    const rows = messages(120);
    const stored = Promise.withResolvers<void>();
    let mounted: ReturnType<typeof mount> | undefined;
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      // Shown, but the cache session changed before it was stored.
      .mockResolvedValueOnce(
        serverPage(rows, 20, 70, Promise.reject(new StaleCacheAuthorityError()))
      )
      // Read again with no connection.
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // Read again once it is back, and stored: the device holds it now.
      .mockImplementationOnce(async () => {
        mounted?.setHeld(true);
        stored.resolve();
        return serverPage(rows, 20, 70);
      });
    mounted = mount({ rows, fetchPage });
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      onlineManager.setOnline(false);
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(100);

      onlineManager.setOnline(true);
      await stored.promise;
      await until(() => !mounted.timeline.isLoadingOlder());
      expect(fetchPage.mock.calls.map(([input]) => input.before)).toEqual([
        rows[70]!.sortKey,
        rows[70]!.sortKey,
        rows[70]!.sortKey,
      ]);
    } finally {
      mounted.dispose();
      vi.unstubAllGlobals();
      onlineManager.setOnline(true);
    }
  });

  it('loads no missing target again whose connection came back before the server said so', async () => {
    const rows = messages(2);
    const asked = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementationOnce(() => {
        asked.resolve();
        return pending.promise;
      })
      .mockResolvedValue(serverPage(rows, 0, 2));
    onlineManager.setOnline(false);
    const mounted = mount({ rows, held: false, around: 'gone', fetchPage });
    // As the channel view does: a missing target shows the live end.
    const disposeView = createRoot((dispose) => {
      createEffect(() => {
        if (!mounted.timeline.isMissingTarget()) return;
        mounted.setHeld(true);
        mounted.setAround(undefined);
      });
      return dispose;
    });
    try {
      await asked.promise;
      onlineManager.setOnline(true);
      pending.reject(
        new CombinedError({
          graphQLErrors: [
            { message: 'gone', extensions: { code: 'NOT_FOUND' } },
          ],
        })
      );

      await until(() => mounted.timeline.entries().length === 2);
      expect(mounted.host.reads.map(({ around }) => around)).toEqual([
        channelMessageKey('gone'),
        undefined,
      ]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    } finally {
      disposeView();
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads a window again once the connection is back after its reload failed with none', async () => {
    const rows = messages(2);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 2, cached.promise))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    onlineManager.setOnline(false);
    const mounted = mount({ rows, held: false, fetchPage });
    try {
      await until(() => mounted.timeline.entries().length === 2);
      // The session changed before the window was stored; the reload fails.
      cached.reject(new StaleCacheAuthorityError());
      await until(mounted.timeline.isLoadingOlder);
      await mounted.timeline.toLatest();
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(mounted.timeline.entries()).toHaveLength(2);
      expect(mounted.timeline.loadError()).toBeUndefined();

      mounted.setHeld(true);
      mounted.addRow(graphqlMessage(3));
      onlineManager.setOnline(true);
      await mounted.timeline.toLatest();
      expect(mounted.timeline.entries()).toHaveLength(3);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads a page the device refused at every read again once the connection is back', async () => {
    const rows = messages(70);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementation(async () =>
        serverPage(rows, 0, 20, Promise.reject(new StaleCacheAuthorityError()))
      );
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      onlineManager.setOnline(false);
      await mounted.timeline.loadOlder();
      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(mounted.timeline.entries()).toHaveLength(70);
      expect(mounted.timeline.isLoadingOlder()).toBe(false);

      mounted.setHeld(true);
      const reads = mounted.host.reads.length;
      onlineManager.setOnline(true);
      expect(
        mounted.host.reads.slice(reads).map(({ before }) => before)
      ).toEqual([rows[20]!.sortKey]);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads a page the device did not take again on the next scroll, not past it', async () => {
    const rows = messages(120);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(
        serverPage(rows, 20, 70, Promise.reject(new StaleCacheAuthorityError()))
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(serverPage(rows, 20, 70));
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      onlineManager.setOnline(false);
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(100);

      await mounted.timeline.loadOlder();
      expect(fetchPage.mock.calls.map(([input]) => input.before)).toEqual([
        rows[70]!.sortKey,
        rows[70]!.sortKey,
        rows[70]!.sortKey,
      ]);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads a refused page again as paging restarts the moment it ends, and gives it up once refused again', async () => {
    const rows = messages(120);
    // Every page the server sends, the device refuses to store.
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementation(async ({ before }) => {
        const to = rows.findIndex((row) => row.sortKey === before);
        return serverPage(
          rows,
          Math.max(0, to - 50),
          to,
          Promise.reject(new StaleCacheAuthorityError())
        );
      });
    const mounted = mount({ rows, fetchPage });
    const loads: Promise<void>[] = [];
    let disposeEffect = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      // A call panel seeking an older root pages whenever paging is idle.
      createRoot((dispose) => {
        disposeEffect = dispose;
        createEffect(
          on(
            () =>
              mounted.timeline.hasOlder() && !mounted.timeline.isLoadingOlder(),
            (idle) => {
              if (idle) loads.push(mounted.timeline.loadOlder());
            }
          )
        );
      });
      await until(
        () => !mounted.timeline.hasOlder() && !mounted.timeline.isLoadingOlder()
      );
      await Promise.all(loads);
      expect(fetchPage.mock.calls.map(([input]) => input.before)).toEqual([
        ...Array.from({ length: 5 }, () => rows[70]!.sortKey),
        rows[20]!.sortKey,
      ]);
    } finally {
      disposeEffect();
      mounted.dispose();
    }
  });

  it('reads a newer page the device refused again while an older one waits too', async () => {
    const rows = messages(200);
    const refused = (
      entries: Row[],
      older: string | null,
      newer: string | null
    ) => ({
      page: {
        __typename: 'GraphqlChannelTimelinePage',
        entries: [...entries].reverse(),
        olderCursor: older,
        newerCursor: newer,
        seq: '9',
      } as never,
      cached: Promise.reject(new StaleCacheAuthorityError()),
    });
    const at = (sortKey: string | null | undefined) =>
      rows.findIndex((row) => row.sortKey === sortKey);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementation(async ({ before, after }) => {
        if (before !== undefined) {
          const to = at(before);
          return refused(
            rows.slice(to - 50, to),
            rows[to - 50]!.sortKey,
            before
          );
        }
        const from = at(after) + 1;
        return refused(
          rows.slice(from, from + 50),
          after!,
          rows[from + 49]!.sortKey
        );
      });
    const mounted = mount({ rows, fetchPage, around: rows[100]!.id });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      // The window's newest message, where its newer pages start.
      const newest = rows.find((row) => row.id === ids(mounted.timeline)[0]);
      const newerCursor = newest!.sortKey;
      await mounted.timeline.loadOlder();
      await mounted.timeline.loadNewer();
      await mounted.timeline.loadNewer();
      const newer = fetchPage.mock.calls
        .map(([input]) => input.after)
        .filter((after) => after !== undefined);
      expect(newer).toEqual(Array.from({ length: 5 }, () => newerCursor));
    } finally {
      mounted.dispose();
    }
  });

  it('keeps a last older page the device refused there to read again', async () => {
    const rows = messages(70);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementation(async () =>
        serverPage(rows, 0, 20, Promise.reject(new StaleCacheAuthorityError()))
      );
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      await mounted.timeline.loadOlder();
      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(mounted.timeline.hasOlder()).toBe(true);

      // The device stores it now, with the connection there all along.
      fetchPage.mockImplementation(async () => serverPage(rows, 0, 20));
      await mounted.timeline.loadOlder();
      expect(fetchPage.mock.calls.map(([input]) => input.before)).toEqual(
        Array.from({ length: 4 }, () => rows[20]!.sortKey)
      );
      expect(mounted.timeline.hasOlder()).toBe(false);
    } finally {
      mounted.dispose();
    }
  });

  it('goes to the live end only once a window read again at once after its reload failed has loaded', async () => {
    const rows = messages(2);
    const cached = Promise.withResolvers<void>();
    const reloading = Promise.withResolvers<void>();
    const reload = Promise.withResolvers<ServerPage>();
    const retrying = Promise.withResolvers<void>();
    const retry = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 2, cached.promise))
      .mockImplementationOnce(() => {
        reloading.resolve();
        return reload.promise;
      })
      .mockImplementationOnce(() => {
        retrying.resolve();
        return retry.promise;
      });
    const mounted = mount({ rows, held: false, fetchPage });
    try {
      await until(() => mounted.timeline.entries().length === 2);
      // The session changed before the window was stored: it is read again.
      cached.reject(new StaleCacheAuthorityError());
      await reloading.promise;
      onlineManager.setOnline(false);
      let atLatest = false;
      const latest = (async () => {
        await mounted.timeline.toLatest();
        atLatest = true;
      })();
      // Back before the read again fails: it is read again at once.
      onlineManager.setOnline(true);
      reload.reject(new TypeError('Failed to fetch'));
      await retrying.promise;
      await settle();
      expect(atLatest).toBe(false);

      const grown = [...rows, graphqlMessage(3)];
      retry.resolve(serverPage(grown, 0, 3));
      await latest;
      expect(mounted.timeline.entries()).toHaveLength(3);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('leaves a failed older page to a scroll or the connection, not to paging whenever idle', async () => {
    const rows = messages(70);
    const refused = () =>
      serverPage(rows, 0, 20, Promise.reject(new StaleCacheAuthorityError()));
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(refused())
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const mounted = mount({ rows, fetchPage });
    let dispose = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      // Refused three times: the last page is left to read again.
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.hasOlder()).toBe(true);
      // As the call panel does while its call's row is not loaded.
      createRoot((cleanup) => {
        dispose = cleanup;
        createEffect(
          on(
            () =>
              mounted.timeline.hasOlder() &&
              !mounted.timeline.isLoadingOlder() &&
              !mounted.timeline.olderFailed(),
            (idle) => {
              if (idle)
                fireAndForget(mounted.timeline.loadOlder(), 'channel-call');
            }
          )
        );
      });
      await until(() => mounted.timeline.olderFailed());
      expect(fetchPage).toHaveBeenCalledTimes(4);

      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      // Read again at once, and failed again.
      expect(mounted.timeline.olderFailed()).toBe(false);
      await until(() => mounted.timeline.olderFailed());
      expect(fetchPage.mock.calls.map(([input]) => input.before)).toEqual(
        Array.from({ length: 5 }, () => rows[20]!.sortKey)
      );
    } finally {
      dispose();
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads the window from the device only once a page it shows is stored', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const loading = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);
      mounted.setHeld(true);
      const reads = mounted.host.reads.length;
      // A change while the page is still storing reads nothing yet.
      mounted.runtime.changed();
      await settle();
      expect(mounted.host.reads.length).toBe(reads);

      cached.resolve();
      await loading;
      await until(() => mounted.host.reads.length > reads);
      expect(mounted.timeline.entries()).toHaveLength(70);
    } finally {
      cached.resolve();
      mounted.dispose();
    }
  });

  it('keeps no window for the next mount while a page it shows is storing', async () => {
    const rows = messages(70);
    const windows = createChannelWindows();
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const mounted = mount({ rows, fetchPage, windows });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const loading = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);
      mounted.dispose();
      cached.reject(new StaleCacheAuthorityError());
      await loading;
      expect(windows.take(CHANNEL_ID)).toBeUndefined();
    } finally {
      cached.resolve();
      mounted.dispose();
    }
  });

  it('keeps no window for the next mount when a page was given up while the window stored', async () => {
    const rows = messages(70);
    const opening = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 20, 70, opening.promise))
      .mockResolvedValueOnce(
        serverPage(rows, 0, 20, Promise.reject(new StaleCacheAuthorityError()))
      );
    const windows = createChannelWindows();
    const mounted = mount({ rows, held: false, fetchPage, windows });
    try {
      await until(() => mounted.timeline.entries().length === 50);
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.entries()).toHaveLength(70);
      opening.resolve();
      await settle();
      mounted.dispose();
      expect(windows.take(CHANNEL_ID)).toBeUndefined();
    } finally {
      opening.resolve();
      mounted.dispose();
    }
  });

  it('goes to the live end from a window around a message only once its retry on reconnect has loaded', async () => {
    const rows = messages(2);
    const cached = Promise.withResolvers<void>();
    const reloading = Promise.withResolvers<void>();
    const reload = Promise.withResolvers<ServerPage>();
    const retrying = Promise.withResolvers<void>();
    const retry = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 2))
      .mockResolvedValueOnce(serverPage(rows, 0, 2, cached.promise))
      .mockImplementationOnce(() => {
        reloading.resolve();
        return reload.promise;
      })
      .mockImplementationOnce(() => {
        retrying.resolve();
        return retry.promise;
      });
    const mounted = mount({
      rows,
      held: false,
      around: rows[0]!.id,
      fetchPage,
    });
    try {
      await until(() => mounted.timeline.entries().length === 2);
      let atLatest = false;
      const latest = (async () => {
        await mounted.timeline.toLatest();
        atLatest = true;
      })();
      // The live end's window was not stored: it is read again, and that
      // read fails after the connection came back, so it is read at once.
      cached.reject(new StaleCacheAuthorityError());
      await reloading.promise;
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      reload.reject(new TypeError('Failed to fetch'));
      await retrying.promise;
      await settle();
      expect(atLatest).toBe(false);

      retry.resolve(serverPage([...rows, graphqlMessage(3)], 0, 3));
      await latest;
      expect(mounted.timeline.entries()).toHaveLength(3);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('does not read on reconnect a page given up in the other direction', async () => {
    const rows = messages(250);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockImplementation(async ({ before, after }) => {
        const from =
          before === undefined
            ? rows.findIndex((row) => row.sortKey === after) + 1
            : rows.findIndex((row) => row.sortKey === before) - 50;
        const to = from + 50;
        const page = serverPage(
          rows,
          from,
          to,
          Promise.reject(new StaleCacheAuthorityError())
        );
        if (after !== undefined)
          (page.page as { newerCursor: string | null }).newerCursor =
            rows[to - 1]!.sortKey;
        return page;
      });
    const mounted = mount({ rows, around: rows[100]!.id, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      // Each refused three times, so both are left to read again.
      await mounted.timeline.loadNewer();
      await mounted.timeline.loadOlder();
      // Refused again: the older page is given up, and so is the newer one.
      await mounted.timeline.loadOlder();
      expect(fetchPage).toHaveBeenCalledTimes(8);
      const reads = mounted.host.reads.length;
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await settle();
      expect(mounted.host.reads.slice(reads)).toEqual([]);
      expect(fetchPage).toHaveBeenCalledTimes(8);
    } finally {
      mounted.dispose();
      onlineManager.setOnline(true);
    }
  });

  it('reads a change into a window loaded again while a page of the old one stores', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const oldPage = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);
      mounted.setHeld(true);
      await mounted.timeline.retry();
      expect(mounted.timeline.entries()).toHaveLength(50);

      const latest = graphqlMessage(71);
      mounted.addRow(latest);
      mounted.runtime.changed();
      await until(() => ids(mounted.timeline)[0] === latest.id);
      cached.resolve();
      await oldPage;
    } finally {
      cached.resolve();
      mounted.dispose();
    }
  });

  it('keeps for the next mount a window loaded again while a page of the old one stores', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const windows = createChannelWindows();
    const mounted = mount({ rows, fetchPage, windows });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const oldPage = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);
      mounted.setHeld(true);
      await mounted.timeline.retry();
      mounted.dispose();
      expect(windows.take(CHANNEL_ID)?.entries).toHaveLength(50);
      cached.resolve();
      await oldPage;
    } finally {
      cached.resolve();
      mounted.dispose();
    }
  });

  it('reads a change that came while the device read the window', async () => {
    const rows = messages(70);
    const mounted = mount({ rows });
    const captured = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    try {
      await settledOnDevice(mounted.runtime);
      const read = mounted.host.channelTimeline;
      let gated = false;
      mounted.host.channelTimeline = async (request) => {
        const result = await read(request);
        if (!gated) {
          gated = true;
          captured.resolve();
          await answer.promise;
        }
        return result;
      };
      const window = mounted.timeline.retry();
      await captured.promise;
      const latest = graphqlMessage(71);
      mounted.addRow(latest);
      mounted.runtime.changed();
      answer.resolve();
      await window;
      await until(() => ids(mounted.timeline)[0] === latest.id);
    } finally {
      answer.resolve();
      mounted.dispose();
    }
  });

  it('reads nothing from the device between a page stored and its sibling marked unstored', async () => {
    const rows = messages(250);
    const readTooEarly: number[] = [];
    for (let turns = 0; turns <= 20; turns += 1) {
      const older = Promise.withResolvers<void>();
      const newer = Promise.withResolvers<void>();
      const fetchPage = vi
        .fn<FetchChannelServerPage>()
        .mockImplementation(async ({ before }) =>
          before
            ? serverPage(rows, 25, 75, older.promise)
            : serverPage(rows, 125, 175, newer.promise)
        );
      const mounted = mount({ rows, around: rows[100]!.id, fetchPage });
      try {
        await settledOnDevice(mounted.runtime);
        mounted.setHeld(false);
        const loadOlder = mounted.timeline.loadOlder();
        const loadNewer = mounted.timeline.loadNewer();
        await until(() => mounted.timeline.entries().length === 150);
        mounted.runtime.changed();
        const reads = mounted.host.reads.length;

        newer.resolve();
        for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
        older.reject(new Error('device write failed'));
        await Promise.all([loadOlder, loadNewer]);
        await settle();
        if (mounted.host.reads.length > reads) readTooEarly.push(turns);
      } finally {
        older.resolve();
        newer.resolve();
        mounted.dispose();
      }
    }
    expect(readTooEarly).toEqual([]);
  });

  it('goes to the live end once a window loaded since is shown, not once the old one stores', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 20, 70, cached.promise));
    const mounted = mount({ rows, around: rows[0]!.id, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const latest = mounted.timeline.toLatest();
      await until(() => mounted.timeline.entries().length === 50);
      const replacement = settledOnDevice(mounted.runtime);
      mounted.addRow(graphqlMessage(71));
      mounted.setHeld(true);
      mounted.setAround(undefined);
      await replacement;
      await latest;
      expect(ids(mounted.timeline)[0]).toBe(graphqlMessage(71).id);
    } finally {
      cached.resolve();
      mounted.dispose();
    }
  });

  it('lets a view that pages whenever idle ask again for a failed page after a growing wait', async () => {
    const rows = messages(70);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const mounted = mount({ rows, fetchPage });
    let dispose = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // The page path waits on zero-delay timers of its own: run those, and
      // never the retry wait, which only the test moves past.
      const failedAgain = async () => {
        for (
          let turn = 0;
          turn < 100 && !mounted.timeline.olderFailed();
          turn += 1
        )
          await vi.advanceTimersByTimeAsync(0);
        expect(mounted.timeline.olderFailed()).toBe(true);
      };
      createRoot((cleanup) => {
        dispose = cleanup;
        createEffect(
          on(
            () =>
              mounted.timeline.hasOlder() &&
              !mounted.timeline.isLoadingOlder() &&
              !mounted.timeline.olderFailed(),
            (idle) => {
              if (idle)
                fireAndForget(mounted.timeline.loadOlder(), 'channel-call');
            }
          )
        );
      });
      await failedAgain();
      expect(fetchPage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(PAGE_RETRY_MS - 1);
      expect(fetchPage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await failedAgain();
      expect(fetchPage).toHaveBeenCalledTimes(2);
      // The second wait is twice the first.
      await vi.advanceTimersByTimeAsync(2 * PAGE_RETRY_MS - 1);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await failedAgain();
      expect(fetchPage).toHaveBeenCalledTimes(3);
    } finally {
      dispose();
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps following a replacement window started by an observer of the page merge', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const mounted = mount({ rows, fetchPage });
    const replacement = Promise.withResolvers<Promise<void>>();
    let stopObserving = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      createRoot((dispose) => {
        stopObserving = dispose;
        createEffect(
          on(
            () => mounted.timeline.entries().length,
            (count) => {
              if (count !== 70) return;
              mounted.setHeld(true);
              replacement.resolve(mounted.timeline.retry());
            }
          )
        );
      });
      mounted.setHeld(false);
      const oldPage = mounted.timeline.loadOlder();
      await replacement.promise;
      expect(mounted.timeline.entries()).toHaveLength(50);
      cached.resolve();
      await oldPage;
      const latest = graphqlMessage(71);
      mounted.addRow(latest);
      const reads = mounted.host.reads.length;
      mounted.runtime.changed();
      expect(mounted.host.reads.length).toBe(reads + 1);
      await until(() => ids(mounted.timeline)[0] === latest.id);
    } finally {
      cached.resolve();
      stopObserving();
      mounted.dispose();
    }
  });

  it('does not start a reread when an observer reports a change as the page is merged', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise));
    const mounted = mount({ rows, fetchPage });
    const observedReadCount = Promise.withResolvers<number>();
    let stopObserving = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      createRoot((dispose) => {
        stopObserving = dispose;
        createEffect(
          on(
            () => mounted.timeline.entries().length,
            (count) => {
              if (count !== 70) return;
              const before = mounted.host.reads.length;
              mounted.runtime.changed();
              observedReadCount.resolve(mounted.host.reads.length - before);
            }
          )
        );
      });
      mounted.setHeld(false);
      const oldPage = mounted.timeline.loadOlder();
      expect(await observedReadCount.promise).toBe(0);
      mounted.setHeld(true);
      cached.resolve();
      await oldPage;
    } finally {
      cached.resolve();
      stopObserving();
      mounted.dispose();
    }
  });

  it('does not arm a retry after disposal triggered by publication of the page failure', async () => {
    const rows = messages(70);
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const mounted = mount({ rows, fetchPage });
    let stopObserving = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      createRoot((dispose) => {
        stopObserving = dispose;
        createEffect(
          on(mounted.timeline.olderFailed, (failed) => {
            if (failed) mounted.dispose();
          })
        );
      });
      const failed = mounted.timeline.loadOlder();
      await vi.advanceTimersByTimeAsync(0);
      await failed;
      expect(mounted.timeline.olderFailed()).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mounted.timeline.olderFailed()).toBe(true);
    } finally {
      stopObserving();
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('replays changes after the old page settles during a replacement page store', async () => {
    const rows = messages(70);
    const cached = Promise.withResolvers<void>();
    const replacementCached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 0, 20, cached.promise))
      .mockResolvedValueOnce(
        serverPage(rows, 0, 20, replacementCached.promise)
      );
    const mounted = mount({ rows, fetchPage });
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      const oldPage = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);
      mounted.setHeld(true);
      await mounted.timeline.retry();
      expect(mounted.timeline.entries()).toHaveLength(50);
      mounted.setHeld(false);
      const currentPage = mounted.timeline.loadOlder();
      await until(() => mounted.timeline.entries().length === 70);

      const latest = graphqlMessage(71);
      mounted.addRow(latest);
      mounted.runtime.changed();
      mounted.setHeld(true);
      const reads = mounted.host.reads.length;
      cached.resolve();
      await oldPage;
      expect(mounted.host.reads.length).toBe(reads);
      expect(ids(mounted.timeline)[0]).not.toBe(latest.id);

      replacementCached.resolve();
      await currentPage;
      await until(() => ids(mounted.timeline)[0] === latest.id);
    } finally {
      cached.resolve();
      replacementCached.resolve();
      mounted.dispose();
    }
  });

  const mountWithTwoFailedPages = async () => {
    const rows = messages(70);
    const second = Promise.withResolvers<ServerPage>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(second.promise);
    const mounted = mount({ rows, fetchPage });
    await settledOnDevice(mounted.runtime);
    mounted.setHeld(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return { mounted, second, fetchPage };
  };

  it('keeps the second failure marked until its own retry deadline', async () => {
    const { mounted, second, fetchPage } = await mountWithTwoFailedPages();
    const retry = Promise.withResolvers<void>();
    const stop = createRoot((dispose) => {
      let retried = false;
      createEffect(
        on(mounted.timeline.olderFailed, (failed) => {
          if (!failed || retried) return;
          retried = true;
          retry.resolve(mounted.timeline.loadOlder());
        })
      );
      return dispose;
    });

    try {
      const first = mounted.timeline.loadOlder();
      await vi.advanceTimersByTimeAsync(0);
      await first;
      expect(fetchPage).toHaveBeenCalledTimes(2);
      second.reject(new TypeError('Still offline'));
      await retry.promise;
      expect(mounted.timeline.olderFailed()).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
      expect(mounted.timeline.olderFailed()).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mounted.timeline.olderFailed()).toBe(false);
    } finally {
      stop();
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('cancels an older wait when a new page starts after failure publication', async () => {
    const { mounted, second, fetchPage } = await mountWithTwoFailedPages();
    try {
      const first = mounted.timeline.loadOlder();
      await vi.advanceTimersByTimeAsync(0);
      await first;
      expect(mounted.timeline.olderFailed()).toBe(true);
      const retry = mounted.timeline.loadOlder();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      second.reject(new TypeError('Still offline'));
      await retry;

      await vi.advanceTimersByTimeAsync(2000);
      expect(mounted.timeline.olderFailed()).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mounted.timeline.olderFailed()).toBe(false);
    } finally {
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('starts pagination in the replacement window while the old page store is pending', async () => {
    const rows = messages(150);
    const cached = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockResolvedValueOnce(serverPage(rows, 50, 100, cached.promise))
      .mockResolvedValueOnce(serverPage(rows, 0, 50));
    const mounted = mount({ rows, fetchPage });
    const [windowKey, setWindowKey] = createSignal(0);
    const { paginator, dispose } = createRoot((dispose) => ({
      paginator: createThreadPaginator(mounted.timeline, windowKey),
      dispose,
    }));
    let oldScroll: Promise<void> | undefined;
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      oldScroll = paginator.shiftPaginate();
      await until(() => ids(mounted.timeline).length === 100);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      mounted.setHeld(true);
      setWindowKey(1);
      await mounted.timeline.retry();
      expect(ids(mounted.timeline)).toHaveLength(50);
      expect(mounted.timeline.isLoadingOlder()).toBe(false);
      mounted.setHeld(false);
      await paginator.shiftPaginate();

      // Advance the already-queued work while keeping the old store blocked.
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      cached.resolve();
      if (oldScroll) await oldScroll;
      dispose();
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('starts a fresh retry delay when the next page fails after a successful retry', async () => {
    const rows = messages(150);
    const laterFailure =
      Promise.withResolvers<Awaited<ReturnType<FetchChannelServerPage>>>();
    const nextRequest = Promise.withResolvers<void>();
    const fetchPage = vi
      .fn<FetchChannelServerPage>()
      .mockRejectedValueOnce(new TypeError('Page request failed'))
      .mockResolvedValueOnce(serverPage(rows, 50, 100))
      .mockImplementationOnce(() => {
        nextRequest.resolve();
        return laterFailure.promise;
      });
    const mounted = mount({ rows, fetchPage });
    let stop = () => {};
    try {
      await settledOnDevice(mounted.runtime);
      mounted.setHeld(false);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await mounted.timeline.loadOlder();
      expect(mounted.timeline.olderFailed()).toBe(true);

      // The call panel pages while its root is missing and the direction is idle.
      stop = createRoot((dispose) => {
        createEffect(
          on(
            () =>
              mounted.timeline.hasOlder() &&
              !mounted.timeline.isLoadingOlder() &&
              !mounted.timeline.olderFailed(),
            (shouldLoad) => {
              if (shouldLoad) {
                fireAndForget(mounted.timeline.loadOlder(), 'channel-call');
              }
            }
          )
        );
        return dispose;
      });

      await vi.advanceTimersByTimeAsync(PAGE_RETRY_MS);
      await nextRequest.promise;
      expect(ids(mounted.timeline)).toHaveLength(100);
      expect(fetchPage.mock.calls.map(([request]) => request.before)).toEqual([
        rows[100]!.sortKey,
        rows[100]!.sortKey,
        rows[50]!.sortKey,
      ]);
      stop();
      laterFailure.reject(new TypeError('Next page request failed'));
      await until(mounted.timeline.olderFailed);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(PAGE_RETRY_MS - 1);
      expect(mounted.timeline.olderFailed()).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(mounted.timeline.olderFailed()).toBe(false);
    } finally {
      stop();
      mounted.dispose();
      vi.useRealTimers();
    }
  });

  it('pages a replacement target while the old scroll still has a pending device read', async () => {
    const rows = messages(200);
    const mounted = mount({ rows });
    const [windowKey, setWindowKey] = createSignal(0);
    const { paginator, dispose } = createRoot((dispose) => ({
      paginator: createThreadPaginator(mounted.timeline, windowKey),
      dispose,
    }));
    const oldReadStarted = Promise.withResolvers<void>();
    const releaseOldRead = Promise.withResolvers<void>();
    let oldScroll: Promise<void> | undefined;
    try {
      await settledOnDevice(mounted.runtime);
      const readDevice = mounted.host.channelTimeline.bind(mounted.host);
      vi.spyOn(mounted.host, 'channelTimeline').mockImplementationOnce(
        async (args) => {
          oldReadStarted.resolve();
          await releaseOldRead.promise;
          return readDevice(args);
        }
      );
      oldScroll = paginator.shiftPaginate();
      await oldReadStarted.promise;

      const target = rows[99]!;
      const replacement = settledOnDevice(mounted.runtime);
      setWindowKey(1);
      mounted.setAround(target.id);
      await replacement;
      expect(ids(mounted.timeline)).toContain(target.id);
      expect(mounted.timeline.hasOlder()).toBe(true);
      expect(mounted.timeline.isLoadingOlder()).toBe(false);
      expect(ids(mounted.timeline)).toHaveLength(50);

      await paginator.shiftPaginate();
      // The new target and its older page are independently readable.
      await until(() => ids(mounted.timeline).length === 100);
    } finally {
      releaseOldRead.resolve();
      if (oldScroll) await oldScroll;
      dispose();
      mounted.dispose();
    }
  });
});
