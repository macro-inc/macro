import type { EntityLoadError } from '@core/component/EntityLoadGate';
import { untilAborted } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { sleep } from '@core/util/sleep';
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
import {
  type ReconnectWatch,
  SESSION_CHANGE_RELOADS,
  watchReconnect,
} from './channel-network';
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
/**
 * The first wait before a failed page may be asked for again; it doubles with
 * each failure in a row, up to `PAGE_RETRY_MAX_MS`.
 */
export const PAGE_RETRY_MS = 2_000;
export const PAGE_RETRY_MAX_MS = 60_000;

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
  /**
   * The cursor, per direction, of a page merged into the window that the
   * device did not store: the next page that way reads it again, not past it.
   */
  unstored: Record<PageDirection, string | null>;
  /**
   * The last page that way failed: a scroll or the connection's return reads
   * it again, so nothing that pages whenever paging is idle asks at once.
   */
  pageFailed: Record<PageDirection, boolean>;
};

type PageDirection = 'older' | 'newer';

/** How a page or its read again ended. */
type PageOutcome = 'done' | 'failed' | 'unstored';

/** A channel's timeline read from the device, as one window. */
export interface LocalChannelTimeline {
  /** Newest first. */
  entries: Accessor<MessageTimelineEntry[]>;
  hasOlder: Accessor<boolean>;
  hasNewer: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isLoadingOlder: Accessor<boolean>;
  isLoadingNewer: Accessor<boolean>;
  /** The last older page failed; see `ChannelTimelineSource.olderFailed`. */
  olderFailed: Accessor<boolean>;
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
    unstored: { older: null, newer: null },
    pageFailed: { older: false, newer: false },
  });
  // Every load bumps it; a result for an older load is dropped.
  let loadToken = 0;
  // The device holds the window it loaded and every page stored since.
  let held = false;
  // Pages of this window merged in whose outcome is not recorded yet: the
  // store has not answered, or a refusal is not yet marked unstored.
  let storing = 0;
  // Failed pages in a row per direction, and the wait before the next ask.
  const pageRetries: Record<
    PageDirection,
    { failures: number; wait: AbortController | undefined }
  > = {
    older: { failures: 0, wait: undefined },
    newer: { failures: 0, wait: undefined },
  };
  const stopPageRetry = (direction: PageDirection, reset: boolean) => {
    const retry = pageRetries[direction];
    retry.wait?.abort();
    retry.wait = undefined;
    if (reset) retry.failures = 0;
  };
  /** Clears a failed page once its wait ends, unless stopped meanwhile. */
  const retryAfterWait = async (direction: PageDirection) => {
    const retry = pageRetries[direction];
    retry.failures += 1;
    const wait = new AbortController();
    retry.wait = wait;
    const ms = Math.min(
      PAGE_RETRY_MAX_MS,
      PAGE_RETRY_MS * 2 ** (retry.failures - 1)
    );
    try {
      await untilAborted(sleep(ms), wait.signal);
    } catch {
      return;
    }
    retry.wait = undefined;
    setState('pageFailed', direction, false);
  };
  // Bumped when a page is given up, so a window still storing as one is
  // given up does not then count as held.
  let givenUp = 0;
  // A change came while the window could not be read again.
  let missedReread = false;
  // The device holds every page shown, so the window can be read again.
  const holds = () =>
    held &&
    storing === 0 &&
    state.unstored.older === null &&
    state.unstored.newer === null;
  let anchorId: string | undefined;
  let rereading: Promise<void> | undefined;
  let rereadAgain = false;
  // Bumped when a page is merged in; a reread begun before it is stale.
  let merges = 0;
  let abort: AbortController | undefined;
  let currentLoad: Promise<void> = Promise.resolve();
  // Loads the window again when the connection returns after a failed load.
  let reconnect: ReconnectWatch | undefined;
  // Pages again in a direction whose page failed, when the connection returns.
  const pageReconnects: Record<PageDirection, ReconnectWatch | undefined> = {
    older: undefined,
    newer: undefined,
  };
  const stopReconnects = () => {
    reconnect?.stop();
    pageReconnects.older?.stop();
    pageReconnects.newer?.stop();
  };

  const release = deps.runtime.open(channelId);
  onCleanup(() => {
    // A live window the device holds is left for the next mount to show.
    if (
      holds() &&
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
    stopReconnects();
    stopPageRetry('older', true);
    stopPageRetry('newer', true);
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
    missedReread = false;
    // Pages still storing belong to the window this load replaces.
    storing = 0;
    anchorId = around;
    stopReconnects();
    stopPageRetry('older', true);
    stopPageRetry('newer', true);
    const watch = watchReconnect();
    reconnect = watch;
    if (reloads === 0)
      setState({
        phase: 'loading',
        error: undefined,
        entries: [],
        olderCursor: null,
        newerCursor: null,
        loadingOlder: false,
        loadingNewer: false,
        unstored: { older: null, newer: null },
        pageFailed: { older: false, newer: false },
      });
    // No page while the window is read again: its cursors are the old
    // window's, and a page from them could leave a gap beside the new one.
    // The page loading meanwhile was aborted above, its token now stale.
    else
      setState({
        loadingOlder: true,
        loadingNewer: true,
        unstored: { older: null, newer: null },
        pageFailed: { older: false, newer: false },
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
      watch.stop();
    } catch (error) {
      if (token !== loadToken) return;
      // A reload keeps the window it already shows, and pages from it again.
      // The device may not hold that window, so it follows nothing until it
      // is read again: the connection's return reads it again.
      if (reloads > 0) {
        setState({ loadingOlder: false, loadingNewer: false });
        watch.failed(() => {
          currentLoad = loadWindow(around, 1);
          fireAndForget(currentLoad, 'channel-local-sync');
        });
        return;
      }
      setState({ phase: 'failed', error });
      // With no connection nothing on screen retries it: its return does. A
      // view that answered the failure by loading another window (a missing
      // target shows the live end) stopped this watch as that load started.
      watch.failed(() => fireAndForget(load(around), 'channel-local-sync'));
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
      loadingOlder: false,
      loadingNewer: false,
    });
    // Pages can load from here on, while the window is still storing.
    const givenUpBefore = givenUp;
    let settled: Awaited<ReturnType<typeof settle>>;
    try {
      // A load that replaces this one aborts it: nothing then waits for this
      // window's store, as going to the live end does.
      settled = await untilAborted(settle(loaded, epoch, token), signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
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
    // A page given up meanwhile left the device without what it shows.
    held = settled === 'held' && givenUp === givenUpBefore;
    if (!held) return;
    if (missedReread) scheduleReread();
    // Opening asks the server only when the channel is not proven current.
    fireAndForget(
      trace.run(() => deps.runtime.ensureCurrent(channelId)),
      'channel-local-sync'
    );
  };

  const reread = async () => {
    if (state.phase !== 'ready') {
      // The window being read may predate the change: read it once it holds.
      if (state.phase === 'loading') missedReread = true;
      return;
    }
    if (!holds()) {
      // Read once every page shown is stored, or the window reloaded.
      missedReread = true;
      return;
    }
    missedReread = false;
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
    token: number,
    signal: AbortSignal,
    merged: () => void
  ) => {
    const epoch = deps.runtime.epoch();
    const loaded = await loadChannelPage(
      deps,
      {
        channelId,
        limit: CHANNEL_PAGE_LIMIT,
        ...(direction === 'older' ? { before: cursor } : { after: cursor }),
      },
      signal
    );
    if (token !== loadToken) return 'stale';
    if (loaded === 'unsupported') {
      onUnsupported();
      return 'stale';
    }
    merges += 1;
    // Counted before the merge shows: a view answering it may load another
    // window or report a change while this setState runs.
    merged();
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
   * and a read after the delete can hold what it reads. `unstored` when every
   * read again was refused too.
   */
  const fetchMoreAgain = async (
    direction: PageDirection,
    cursor: string,
    token: number,
    signal: AbortSignal,
    merged: () => void,
    first: 'session-changed' | 'yielded'
  ): Promise<'held' | 'unheld' | 'unstored' | 'stale'> => {
    let settled: Awaited<ReturnType<typeof fetchMore>> = first;
    for (let reloads = 0; reloads < SESSION_CHANGE_RELOADS; reloads += 1) {
      if (settled === 'yielded' && !(await afterDeletes(signal)))
        return 'stale';
      if (token !== loadToken) return 'stale';
      settled = await fetchMore(direction, cursor, token, signal, merged);
      if (settled !== 'yielded' && settled !== 'session-changed')
        return settled;
    }
    return 'unstored';
  };

  /** The window stops following the device until it is loaded again. */
  const letGo = () => {
    held = false;
    givenUp += 1;
    // A failed read again of a page given up is not read on reconnect.
    for (const direction of ['older', 'newer'] as const)
      if (state.unstored[direction] !== null) pageReconnects[direction]?.stop();
    setState('unstored', { older: null, newer: null });
  };

  /**
   * Pages in at `cursor` in `direction`. A page merged into a held window that
   * the device did not take keeps its cursor in `unstored`: the next page that
   * way reads it again instead of paging past it, and the window follows the
   * device only once it holds every page. A page refused again then is given
   * up, so nothing that keeps asking for pages reads the same one forever.
   */
  const pageIn = async (
    direction: PageDirection,
    cursor: string,
    again: boolean,
    token: number,
    signal: AbortSignal,
    merged: () => void
  ): Promise<PageOutcome | 'stale'> => {
    let settled: Awaited<ReturnType<typeof fetchMoreAgain>>;
    if (again) {
      settled = await fetchMoreAgain(
        direction,
        cursor,
        token,
        signal,
        merged,
        'session-changed'
      );
    } else {
      const first = await fetchMore(direction, cursor, token, signal, merged);
      if (first === 'stale') return 'stale';
      if (first === 'held') return 'done';
      if (first === 'unheld' || !held) {
        letGo();
        return 'done';
      }
      // Marked before the page is read again, so a scroll as the read ends,
      // or a reread meanwhile, finds it.
      setState('unstored', direction, cursor);
      settled = await fetchMoreAgain(
        direction,
        cursor,
        token,
        signal,
        merged,
        first
      );
      if (settled === 'unstored') return 'unstored';
    }
    if (settled === 'stale') return 'stale';
    if (settled !== 'held') {
      letGo();
      return 'done';
    }
    setState('unstored', direction, null);
    // Read what changed meanwhile, once the window holds every page again.
    missedReread = true;
    return 'done';
  };

  /**
   * Pages past the window's end in `direction`, or reads again the page there
   * that was merged in but that the device did not take.
   */
  const loadMore = async (direction: PageDirection) => {
    const unstored = state.unstored[direction];
    const cursor =
      unstored ??
      (direction === 'older' ? state.olderCursor : state.newerCursor);
    const flag = direction === 'older' ? 'loadingOlder' : 'loadingNewer';
    if (cursor === null || state[flag] || state.phase !== 'ready') return;
    const token = loadToken;
    abort ??= new AbortController();
    const signal = abort.signal;
    pageReconnects[direction]?.stop();
    const watch = watchReconnect();
    pageReconnects[direction] = watch;
    stopPageRetry(direction, false);
    setState(flag, true);
    setState('pageFailed', direction, false);
    // From the merge until its outcome is recorded, the device may lack the
    // page: nothing reads the window from it, nor keeps it for the next mount.
    let pending = false;
    const merged = () => {
      if (pending) return;
      pending = true;
      storing += 1;
    };
    let outcome: PageOutcome | 'stale';
    try {
      outcome = await pageIn(
        direction,
        cursor,
        unstored !== null,
        token,
        signal,
        merged
      );
    } catch (error) {
      // Aborted by a switch or unmount: nothing failed.
      outcome = token === loadToken ? 'failed' : 'stale';
      if (outcome === 'failed')
        Telemetry.error(error, { surface: 'channel-local-sync' });
    }
    // A later window load counted its own pages from zero.
    if (pending && token === loadToken) {
      storing -= 1;
      // A change skipped while it stored is read once every page is held.
      if (missedReread && holds()) scheduleReread();
    }
    if (outcome === 'stale' || token !== loadToken) {
      watch.stop();
      return;
    }
    // One update, so a view watching both never sees paging idle and the
    // failure not yet marked.
    setState(
      produce((draft) => {
        draft[flag] = false;
        draft.pageFailed[direction] = outcome === 'failed';
      })
    );
    // A view answering that update may have closed this window or loaded
    // another, which stopped its watches.
    if (token !== loadToken) return;
    if (outcome === 'done') {
      stopPageRetry(direction, true);
      watch.stop();
      return;
    }
    if (outcome === 'failed') {
      // Online, the connection does not come back: a view that pages
      // whenever paging is idle may ask again after a wait that grows.
      fireAndForget(retryAfterWait(direction), 'channel-local-sync');
    } else stopPageRetry(direction, true);
    // The window keeps what it shows. The next scroll asks again, and so does
    // the connection coming back: scrolled to the end there is no next
    // scroll.
    watch.failed(() =>
      fireAndForget(loadMore(direction), 'channel-local-sync')
    );
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
    // A last page the device did not store is still there to read again.
    hasOlder: () => state.olderCursor !== null || state.unstored.older !== null,
    hasNewer: () => state.newerCursor !== null,
    isLoading: () => state.phase === 'loading',
    isLoadingOlder: () => state.loadingOlder,
    isLoadingNewer: () => state.loadingNewer,
    olderFailed: () => state.pageFailed.older,
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
      let awaited =
        anchorId !== undefined || state.newerCursor !== null
          ? load(undefined)
          : currentLoad;
      await awaited;
      // A load that fails after the connection came back is replaced by its
      // retry as it fails: wait for whichever load is current.
      while (awaited !== currentLoad) {
        awaited = currentLoad;
        await awaited;
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
