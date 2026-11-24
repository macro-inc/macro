import type { EntityLoadError } from '@core/component/EntityLoadGate';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import type { MessageTimelineEntry } from '@service-storage/messages';
import { CombinedError } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { SESSION_CHANGE_RELOADS } from './channel-network';
import {
  type ChannelPage,
  type ChannelPageDeps,
  type ChannelPageEntry,
  type ChannelPageRequest,
  type DeviceRead,
  type LoadedChannelPage,
  loadChannelPage,
  readDeviceChannelPage,
} from './channel-pages';
import { afterDeletes } from './channel-resets';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

/** Entries a page asks for, as the REST timeline does. */
export const CHANNEL_PAGE_LIMIT = 50;
/** Entries one device reread asks for while following the window. */
const REREAD_PAGE_LIMIT = 100;

export type ChannelTimelineRuntime = Pick<
  ChannelSyncRuntime,
  | 'open'
  | 'onChanged'
  | 'noteStoredSeq'
  | 'noteServerRead'
  | 'ensureCurrent'
  | 'epoch'
>;

export interface ChannelTimelineDeps extends ChannelPageDeps {
  runtime: ChannelTimelineRuntime;
  /**
   * Roots this page sent that the device does not hold yet, newest first; the
   * live end shows them until the device's copy replaces them.
   */
  unstored?: (channelId: string) => readonly ChannelPageEntry[];
  /** Windows left by timelines that unmounted, for the next mount to show. */
  windows?: ChannelWindows;
}

/** A live window the device held when its timeline unmounted. */
export type LeftWindow = {
  /** Newest first. */
  entries: readonly ChannelPageEntry[];
  olderCursor: string | null;
};

/**
 * The live windows of the channels this page left most recently, in memory
 * only. A view mounted again (another tab and back, a split reopened) shows
 * the window it left at once, so its list can restore the reading position,
 * then reads the device again: the window is what it showed, not a copy of
 * the channel to trust.
 */
export interface ChannelWindows {
  keep(channelId: string, window: LeftWindow): void;
  /** The window left for this channel, handed out once. */
  take(channelId: string): LeftWindow | undefined;
  /** Forgets every window: the cache session they were read in is over. */
  clear(): void;
}

/** Channels whose last window is kept, as REST keeps recent query pages. */
const KEPT_WINDOWS = 8;

export function createChannelWindows(limit = KEPT_WINDOWS): ChannelWindows {
  const kept = new Map<string, LeftWindow>();
  return {
    keep(channelId, window) {
      kept.delete(channelId);
      kept.set(channelId, window);
      for (const oldest of kept.keys()) {
        if (kept.size <= limit) break;
        kept.delete(oldest);
      }
    },
    take(channelId) {
      const window = kept.get(channelId);
      kept.delete(channelId);
      return window;
    },
    clear() {
      kept.clear();
    },
  };
}

type TimelineState = {
  phase: 'loading' | 'ready' | 'failed';
  error: unknown;
  /** Newest first. */
  entries: ChannelPageEntry[];
  /** Continues older; null at the channel's first entry. */
  olderCursor: string | null;
  /** Continues newer; null while the window reaches the live end. */
  newerCursor: string | null;
  loadingOlder: boolean;
  loadingNewer: boolean;
};

/** A channel's timeline read from the device, as one window. */
export interface LocalChannelTimeline {
  /** Newest first. */
  entries: Accessor<MessageTimelineEntry[]>;
  hasOlder: Accessor<boolean>;
  hasNewer: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isLoadingOlder: Accessor<boolean>;
  isLoadingNewer: Accessor<boolean>;
  /** The first load's failure; a failed page keeps what is shown. */
  loadError: Accessor<EntityLoadError | undefined>;
  /** The message the window was asked to centre on does not exist. */
  isMissingTarget: Accessor<boolean>;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  /** Loads the first window again: latest, or around the target. */
  retry(): Promise<void>;
  /** Resolves once the window reaches the live end, loading it if needed. */
  toLatest(): Promise<void>;
}

const LOAD_ERROR_CODES: readonly EntityLoadError[] = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'GONE',
];

function graphqlErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CombinedError)) return undefined;
  const code = error.graphQLErrors[0]?.extensions?.code;
  return typeof code === 'string' ? code : undefined;
}

function toLoadError(error: unknown): EntityLoadError {
  const code = graphqlErrorCode(error);
  return LOAD_ERROR_CODES.find((known) => known === code) ?? 'LOAD_FAILED';
}

/** Merges two newest-first runs, the later read winning for a shared key. */
function mergeEntries(
  current: readonly ChannelPageEntry[],
  incoming: readonly ChannelPageEntry[]
): ChannelPageEntry[] {
  const byKey = new Map(current.map((entry) => [entry.key, entry]));
  for (const entry of incoming) byKey.set(entry.key, entry);
  return [...byKey.values()].sort((left, right) =>
    left.sortKey < right.sortKey ? 1 : left.sortKey > right.sortKey ? -1 : 0
  );
}

type Reread =
  | { kind: 'page'; entries: ChannelPageEntry[]; olderCursor: string | null }
  | { kind: 'lost' };

/**
 * Reads the window again from the device, newest first, from its upper end
 * down to its oldest entry: two requests per hundred entries. `lost` when the
 * device no longer holds all of it (evicted, reset, or failing).
 */
async function rereadWindow(
  host: ChannelPageDeps['host'],
  channelId: string,
  window: {
    oldest: string | undefined;
    reachesStart: boolean;
    newest: string | undefined;
    live: boolean;
    anchorId: string | undefined;
  }
): Promise<Reread> {
  const collected: ChannelPageEntry[] = [];
  const read = async (
    request: Omit<ChannelPageRequest, 'channelId' | 'limit'>
  ): Promise<ChannelPage | undefined> => {
    let result: DeviceRead;
    try {
      result = await readDeviceChannelPage(host, {
        channelId,
        limit: REREAD_PAGE_LIMIT,
        ...request,
      });
    } catch {
      return undefined;
    }
    return result.kind === 'page' ? result.page : undefined;
  };
  const reachedOldest = (page: ChannelPage) =>
    page.olderCursor === null ||
    (window.oldest !== undefined &&
      (page.entries.at(-1)?.sortKey ?? page.olderCursor) <= window.oldest);

  let first: ChannelPage | undefined;
  if (window.live) {
    first = await read({});
  } else if (window.anchorId !== undefined) {
    first = await read({ aroundMessageId: window.anchorId });
  }
  if (!first) return { kind: 'lost' };
  collected.push(...first.entries);

  // Newer than the anchor, up to the window's newest entry.
  let newer = first;
  while (
    !window.live &&
    newer.newerCursor !== null &&
    window.newest !== undefined &&
    newer.newerCursor < window.newest
  ) {
    const next = await read({ after: newer.newerCursor });
    if (!next) return { kind: 'lost' };
    collected.push(...next.entries);
    newer = next;
  }

  let older = first;
  while (!reachedOldest(older) && older.olderCursor !== null) {
    const next = await read({ before: older.olderCursor });
    if (!next) return { kind: 'lost' };
    collected.push(...next.entries);
    older = next;
  }

  const kept = mergeEntries([], collected).filter(
    (entry) =>
      (window.reachesStart ||
        window.oldest === undefined ||
        entry.sortKey >= window.oldest) &&
      (window.live ||
        window.newest === undefined ||
        entry.sortKey <= window.newest)
  );
  return {
    kind: 'page',
    entries: kept,
    olderCursor: window.reachesStart ? null : (kept.at(-1)?.sortKey ?? null),
  };
}

/**
 * The channel's timeline from the device: one window of entries that follows
 * every change the sync runtime or a local write reports, by reading the
 * window again from the device. A window the device does not hold yet comes
 * from the server, which stores it; it follows changes once stored.
 *
 * Owns no queryClient state. Call under a Solid owner; the window lives
 * until it is disposed.
 */
export function createLocalChannelTimeline(
  deps: ChannelTimelineDeps,
  channelId: string,
  aroundMessageId: Accessor<string | null | undefined>,
  onUnsupported: () => void
): LocalChannelTimeline {
  const [state, setState] = createStore<TimelineState>({
    phase: 'loading',
    error: undefined,
    entries: [],
    olderCursor: null,
    newerCursor: null,
    loadingOlder: false,
    loadingNewer: false,
  });
  // Every load bumps it; a result for an older load is dropped.
  let loadToken = 0;
  // The device holds the whole window, so it can be read again.
  let held = false;
  let anchorId: string | undefined;
  let rereading: Promise<void> | undefined;
  let rereadAgain = false;
  // Bumped when a page is merged in; a reread begun before it is stale.
  let merges = 0;
  let abort: AbortController | undefined;
  let currentLoad: Promise<void> = Promise.resolve();

  const release = deps.runtime.open(channelId);
  onCleanup(() => {
    // A live window the device holds is left for the next mount to show.
    if (
      held &&
      anchorId === undefined &&
      state.phase === 'ready' &&
      state.newerCursor === null
    ) {
      deps.windows?.keep(channelId, {
        entries: [...unwrap(state.entries)],
        olderCursor: state.olderCursor,
      });
    }
    release();
    loadToken += 1;
    abort?.abort();
  });

  /**
   * Follows what the page's store step learns of the device: whether it now
   * holds the page, or the cache session changed before it could store it.
   */
  const settle = async (
    loaded: LoadedChannelPage,
    epoch: number,
    token: number
  ): Promise<'held' | 'unheld' | 'session-changed' | 'yielded'> => {
    const stored = await loaded.stored;
    if (stored.kind !== 'stored') return stored.kind;
    const seq = stored.seq;
    if (token !== loadToken) return 'unheld';
    if (loaded.source === 'device') {
      deps.runtime.noteStoredSeq(channelId, seq);
      return 'held';
    }
    deps.runtime.noteServerRead(channelId, seq, epoch, loaded.readSeq);
    return seq === null ? 'unheld' : 'held';
  };

  const load = (around: string | undefined): Promise<void> => {
    currentLoad = loadWindow(around, 0);
    return currentLoad;
  };

  /**
   * Loads the window around a message, or at the live end. A window read
   * again after a session change keeps what it shows until the new page
   * replaces it.
   */
  const loadWindow = async (around: string | undefined, reloads: number) => {
    const token = ++loadToken;
    // Taken before any await: the catch-up joins the open's trace.
    const trace = Telemetry.captureContext();
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    held = false;
    anchorId = around;
    if (reloads === 0)
      setState({
        phase: 'loading',
        error: undefined,
        entries: [],
        olderCursor: null,
        newerCursor: null,
        loadingOlder: false,
        loadingNewer: false,
      });
    const epoch = deps.runtime.epoch();
    let loaded: LoadedChannelPage | 'unsupported';
    try {
      loaded = await loadChannelPage(
        deps,
        {
          channelId,
          limit: CHANNEL_PAGE_LIMIT,
          ...(around !== undefined && { aroundMessageId: around }),
        },
        signal
      );
    } catch (error) {
      if (token !== loadToken) return;
      // A reload keeps the window it already shows.
      if (reloads === 0) setState({ phase: 'failed', error });
      return;
    }
    if (token !== loadToken) return;
    if (loaded === 'unsupported') {
      onUnsupported();
      return;
    }
    setState({
      phase: 'ready',
      entries: loaded.page.entries,
      olderCursor: loaded.page.olderCursor,
      newerCursor: loaded.page.newerCursor,
    });
    const settled = await settle(loaded, epoch, token);
    if (token !== loadToken) return;
    if (settled === 'session-changed' || settled === 'yielded') {
      // The new session can store what the old one could not, and a read
      // after the delete can hold what it reads.
      if (reloads < SESSION_CHANGE_RELOADS) {
        if (settled === 'yielded' && !(await afterDeletes(signal))) return;
        if (token !== loadToken) return;
        currentLoad = loadWindow(around, reloads + 1);
        await currentLoad;
      }
      return;
    }
    held = settled === 'held';
    if (!held) return;
    // Opening asks the server only when the channel is not proven current.
    fireAndForget(
      trace.run(() => deps.runtime.ensureCurrent(channelId)),
      'channel-local-sync'
    );
  };

  const reread = async () => {
    if (!held || state.phase !== 'ready') return;
    const token = loadToken;
    const merged = merges;
    const live = state.newerCursor === null;
    const result = await rereadWindow(deps.host, channelId, {
      oldest: state.entries.at(-1)?.sortKey,
      reachesStart: state.olderCursor === null,
      newest: state.entries[0]?.sortKey,
      live,
      anchorId: anchorId ?? middleMessageId(state.entries),
    });
    if (token !== loadToken) return;
    // A page merged in meanwhile is not in what was read: read again.
    if (merged !== merges) {
      rereadAgain = true;
      return;
    }
    if (result.kind === 'lost') {
      // Reset or evicted meanwhile: load the window again, from the server.
      await load(
        live ? undefined : (anchorId ?? middleMessageId(state.entries))
      );
      return;
    }
    setState('olderCursor', result.olderCursor);
    setState('entries', reconcile(result.entries, { key: 'key' }));
  };

  /** Coalesces change notices into at most one reread in flight. */
  const scheduleReread = () => {
    if (rereading) {
      rereadAgain = true;
      return;
    }
    rereading = (async () => {
      try {
        do {
          rereadAgain = false;
          await reread();
        } while (rereadAgain);
      } finally {
        rereading = undefined;
      }
    })();
    fireAndForget(rereading, 'channel-local-sync');
  };
  onCleanup(deps.runtime.onChanged(channelId, scheduleReread));

  /** Fetches the page past `cursor` and merges it into the window. */
  const fetchMore = async (
    direction: 'older' | 'newer',
    cursor: string,
    token: number
  ) => {
    const epoch = deps.runtime.epoch();
    const loaded = await loadChannelPage(deps, {
      channelId,
      limit: CHANNEL_PAGE_LIMIT,
      ...(direction === 'older' ? { before: cursor } : { after: cursor }),
    });
    if (token !== loadToken) return 'stale';
    if (loaded === 'unsupported') {
      onUnsupported();
      return 'stale';
    }
    merges += 1;
    setState(
      produce((draft) => {
        draft.entries = mergeEntries(draft.entries, loaded.page.entries);
        if (direction === 'older') {
          draft.olderCursor = loaded.page.olderCursor;
        } else {
          draft.newerCursor = loaded.page.newerCursor;
        }
      })
    );
    const settled = await settle(loaded, epoch, token);
    return token === loadToken ? settled : 'stale';
  };

  /**
   * Reads a page of a held window again that the device did not take, as a
   * window load does: the new session can store what the old one could not,
   * and a read after the delete can hold what it reads. Held again, the
   * window follows the device and rereads what changed meanwhile.
   */
  const fetchMoreAgain = async (
    direction: 'older' | 'newer',
    cursor: string,
    token: number,
    signal: AbortSignal,
    first: 'session-changed' | 'yielded'
  ) => {
    let settled: Awaited<ReturnType<typeof fetchMore>> = first;
    for (let reloads = 0; reloads < SESSION_CHANGE_RELOADS; reloads += 1) {
      if (settled === 'yielded' && !(await afterDeletes(signal))) return;
      if (token !== loadToken) return;
      settled = await fetchMore(direction, cursor, token);
      if (settled === 'held') {
        held = true;
        scheduleReread();
        return;
      }
      if (settled !== 'yielded' && settled !== 'session-changed') return;
    }
  };

  const loadMore = async (direction: 'older' | 'newer') => {
    const cursor =
      direction === 'older' ? state.olderCursor : state.newerCursor;
    const flag = direction === 'older' ? 'loadingOlder' : 'loadingNewer';
    if (cursor === null || state[flag] || state.phase !== 'ready') return;
    const token = loadToken;
    abort ??= new AbortController();
    const signal = abort.signal;
    setState(flag, true);
    try {
      const settled = await fetchMore(direction, cursor, token);
      if (settled === 'stale' || settled === 'held') return;
      const wasHeld = held;
      held = false;
      // Still loading until the page is read again: a scroll meanwhile
      // would page past it from a window the device does not hold.
      if (wasHeld && settled !== 'unheld') {
        await fetchMoreAgain(direction, cursor, token, signal, settled);
      }
    } catch (error) {
      // The window keeps what it shows; the next scroll asks again.
      Telemetry.error(error, { surface: 'channel-local-sync' });
    } finally {
      if (token === loadToken) setState(flag, false);
    }
  };

  // The target is set again as the view mounts (undefined, then null): only
  // a different message loads another window.
  const around = createMemo(() => aroundMessageId() ?? undefined);
  // Mounted again without a target: show the window left, then read it again.
  const left =
    untrack(around) === undefined ? deps.windows?.take(channelId) : undefined;
  if (left) {
    loadToken += 1;
    held = true;
    setState({
      phase: 'ready',
      entries: [...left.entries],
      olderCursor: left.olderCursor,
      newerCursor: null,
    });
    scheduleReread();
    fireAndForget(deps.runtime.ensureCurrent(channelId), 'channel-local-sync');
  }
  createEffect(
    on(around, (target) => fireAndForget(load(target), 'channel-local-sync'), {
      defer: left !== undefined,
    })
  );

  const entries = createMemo(() => {
    const unstored =
      state.newerCursor === null ? (deps.unstored?.(channelId) ?? []) : [];
    // The device's copy wins once it holds the message.
    const shown =
      unstored.length === 0
        ? state.entries
        : mergeEntries(unstored, state.entries);
    return shown.map((entry) => entry.entry);
  });

  return {
    entries,
    hasOlder: () => state.olderCursor !== null,
    hasNewer: () => state.newerCursor !== null,
    isLoading: () => state.phase === 'loading',
    isLoadingOlder: () => state.loadingOlder,
    isLoadingNewer: () => state.loadingNewer,
    loadError: () =>
      state.phase === 'failed' ? toLoadError(state.error) : undefined,
    isMissingTarget: () => {
      if (state.phase !== 'failed' || aroundMessageId() == null) return false;
      const code = graphqlErrorCode(state.error);
      return code === 'NOT_FOUND' || code === 'GONE';
    },
    loadOlder: () => loadMore('older'),
    loadNewer: () => loadMore('newer'),
    retry: () => load(untrack(() => aroundMessageId() ?? undefined)),
    toLatest: async () => {
      // A reset target already started loading the live end.
      if (anchorId !== undefined || state.newerCursor !== null) {
        await load(undefined);
      } else {
        await currentLoad;
      }
      if (state.phase === 'failed') throw state.error;
    },
  };
}

/** A message near the middle of the window, to read it again around. */
function middleMessageId(
  entries: readonly ChannelPageEntry[]
): string | undefined {
  const middle = Math.floor(entries.length / 2);
  for (let offset = 0; offset < entries.length; offset += 1) {
    for (const index of [middle + offset, middle - offset]) {
      const entry = entries[index]?.entry;
      if (entry && entry.type !== 'activity') return entry.message.id;
    }
  }
  return undefined;
}
