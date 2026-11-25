import type { EntityLoadError } from '@core/component/EntityLoadGate';
import { untilAborted } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { sleep } from '@core/util/sleep';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import type { MessageTimelineEntry } from '@service-storage/messages';
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
  deviceRetryWait,
  graphqlErrorCode,
  isMissingMessage,
  type ReconnectWatch,
  SESSION_CHANGE_RELOADS,
  viewRetryWait,
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
  type PageStored,
  readDeviceChannelPage,
} from './channel-pages';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

/** Entries a page asks for, as the REST timeline does. */
export const CHANNEL_PAGE_LIMIT = 50;
/** Entries one device reread asks for while following the window. */
const REREAD_PAGE_LIMIT = 100;

export type ChannelTimelineRuntime = Pick<
  ChannelSyncRuntime,
  'open' | 'onChanged' | 'noteServerRead' | 'ensureCurrent' | 'epoch'
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

/** Pages past those it showed that a window read again may still reach over. */
const RELOAD_EXTRA_PAGES = 4;

/** How far a window reached, for the read again that keeps its place. */
type WindowReach = {
  oldest?: string;
  newest?: string;
  middleId?: string;
  /** The most pages to read. */
  pages: number;
};

type ReadReach = {
  /** Newest first. */
  pages: LoadedChannelPage[];
  /** The pages end before the oldest entry the window reached. */
  short: boolean;
};

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
  // Reads in a row that did not leave the window following the device.
  let failures = 0;
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
    const wait = new AbortController();
    retry.wait = wait;
    try {
      await untilAborted(sleep(viewRetryWait(retry.failures)), wait.signal);
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
  // An outage ended while a page was loading or storing, which it may keep
  // from storing.
  let missedResume = false;
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

  /** How storing the page ended, once the runtime knows of the read. */
  const settle = async (
    loaded: LoadedChannelPage,
    epoch: number,
    token: number
  ): Promise<PageStored> => {
    const stored = await loaded.stored;
    if (stored === 'session-changed') return stored;
    if (token !== loadToken) return 'unheld';
    if (loaded.source === 'device') return stored;
    deps.runtime.noteServerRead(channelId, {
      readSeq: loaded.readSeq,
      epoch,
    });
    return stored;
  };

  /**
   * Settles the page as `settle` does, or `aborted` once a load that replaces
   * this one aborts it: nothing then waits for a replaced window's store.
   */
  const settleUnlessAborted = async (
    loaded: LoadedChannelPage,
    epoch: number,
    token: number,
    signal: AbortSignal
  ) => {
    try {
      return await untilAborted(settle(loaded, epoch, token), signal);
    } catch (error) {
      if (signal.aborted) return 'aborted';
      throw error;
    }
  };

  const load = (around: string | undefined): Promise<void> => {
    failures = 0;
    currentLoad = loadWindow(around, 0);
    return currentLoad;
  };

  /**
   * The page a window loads, and, when it is loaded again, the pages beside
   * it as far as the window reached, so a reader who paged away keeps their
   * place. Newest first. At the live end more may have arrived than is worth
   * reading to get back to that place: then the pages around it.
   */
  const readWindowPages = async (
    around: string | undefined,
    reach: WindowReach,
    signal: AbortSignal
  ): Promise<LoadedChannelPage[] | 'unsupported'> => {
    if (reach.oldest === undefined) {
      const read = await readReach(around, reach, signal);
      return read === 'unsupported' ? read : read.pages;
    }
    // One span, so every page of a window read again shares a trace.
    return await Telemetry.span('channel.reload_window', async (span) => {
      const trace = Telemetry.captureContext();
      span.setAttr('channel.id', channelId);
      const read = await readReach(around, reach, signal);
      if (read === 'unsupported') return read;
      const { middleId } = reach;
      let kept = read;
      if (read.short && around === undefined && middleId !== undefined) {
        const near = await trace.run(() =>
          readNear(middleId, reach, signal, read)
        );
        if (near === 'unsupported') return near;
        kept = near;
      }
      span.setAttr('window.reanchored', kept !== read);
      span.setAttr('window.pages', kept.pages.length);
      return kept.pages;
    });
  };

  /** The pages around a message, or `latest` when it was deleted meanwhile. */
  const readNear = async (
    messageId: string,
    reach: WindowReach,
    signal: AbortSignal,
    latest: ReadReach
  ): Promise<ReadReach | 'unsupported'> => {
    try {
      return await readReach(messageId, reach, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!isMissingMessage(error)) throw error;
      return latest;
    }
  };

  const readReach = async (
    around: string | undefined,
    reach: WindowReach,
    signal: AbortSignal
  ): Promise<ReadReach | 'unsupported'> => {
    const trace = Telemetry.captureContext();
    // A device read may not answer an abort: a load replacing this one stops
    // waiting for it.
    const read = (
      request: Pick<ChannelPageRequest, 'before' | 'after' | 'aroundMessageId'>
    ) =>
      trace.run(() =>
        untilAborted(
          loadChannelPage(
            deps,
            { channelId, limit: CHANNEL_PAGE_LIMIT, ...request },
            signal
          ),
          signal
        )
      );
    const first = await read(
      around === undefined ? {} : { aroundMessageId: around }
    );
    if (first === 'unsupported') return first;
    const pages = [first];
    let newer = first.page.newerCursor;
    while (
      newer !== null &&
      reach.newest !== undefined &&
      newer < reach.newest &&
      pages.length < reach.pages
    ) {
      const next = await read({ after: newer });
      if (next === 'unsupported') return next;
      pages.unshift(next);
      // A cursor that does not move would be read forever.
      const cursor: string | null = next.page.newerCursor;
      newer = cursor !== null && cursor > newer ? cursor : null;
    }
    let older = first.page.olderCursor;
    while (
      older !== null &&
      reach.oldest !== undefined &&
      older > reach.oldest &&
      pages.length < reach.pages
    ) {
      const next = await read({ before: older });
      if (next === 'unsupported') return next;
      pages.push(next);
      const cursor: string | null = next.page.olderCursor;
      older = cursor !== null && cursor < older ? cursor : null;
    }
    const short =
      older !== null && reach.oldest !== undefined && older > reach.oldest;
    return { pages, short };
  };

  /** Settles every page a window loaded: held when the device holds each. */
  const settleWindow = async (
    pages: readonly LoadedChannelPage[],
    epoch: number,
    token: number,
    signal: AbortSignal
  ) => {
    const outcomes: Awaited<ReturnType<typeof settleUnlessAborted>>[] = [];
    for (const page of pages)
      outcomes.push(await settleUnlessAborted(page, epoch, token, signal));
    const ended = (['aborted', 'session-changed'] as const).find((outcome) =>
      outcomes.includes(outcome)
    );
    return ended ?? (outcomes.includes('unheld') ? 'unheld' : 'held');
  };

  /**
   * Loads the window around a message, or at the live end. A window read
   * again after a session change or an outage keeps what it shows until as
   * much of it has been read again.
   */
  const loadWindow = async (around: string | undefined, reloads: number) => {
    const token = ++loadToken;
    const reach: WindowReach =
      reloads === 0
        ? { pages: 1 }
        : {
            oldest: state.entries.at(-1)?.sortKey,
            newest: state.entries[0]?.sortKey,
            middleId: middleMessageId(state.entries),
            pages:
              Math.ceil(state.entries.length / CHANNEL_PAGE_LIMIT) +
              RELOAD_EXTRA_PAGES,
          };
    // Taken before any await: the catch-up joins the open's trace.
    const trace = Telemetry.captureContext();
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    held = false;
    missedReread = false;
    missedResume = false;
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
    let loaded: LoadedChannelPage[] | 'unsupported';
    try {
      loaded = await readWindowPages(around, reach, signal);
      watch.stop();
    } catch (error) {
      if (token !== loadToken) return;
      // The message the window is read around is gone, so it shows no more,
      // and the window is read near what is left.
      if (reloads > 0 && around !== undefined && isMissingMessage(error)) {
        watch.stop();
        setState('entries', (entries) =>
          entries.filter((entry) => messageIdOf(entry) !== around)
        );
        currentLoad = loadWindow(undefined, reloads);
        await currentLoad;
        return;
      }
      // A reload keeps the window it already shows, and pages from it again.
      // The device may not hold that window, so it follows nothing until it
      // is read again: after a wait, or as the connection returns.
      if (reloads > 0) {
        setState({ loadingOlder: false, loadingNewer: false });
        failures += 1;
        readLater(around, trace, watch, viewRetryWait(failures));
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
      entries: mergeEntries(
        [],
        loaded.flatMap(({ page }) => page.entries)
      ),
      olderCursor: loaded.at(-1)?.page.olderCursor ?? null,
      newerCursor: loaded[0]?.page.newerCursor ?? null,
      loadingOlder: false,
      loadingNewer: false,
    });
    // Pages can load from here on, while the window is still storing.
    const givenUpBefore = givenUp;
    // Going to the live end waits for the window that replaced this one.
    const settled = await settleWindow(loaded, epoch, token, signal);
    if (settled === 'aborted' || token !== loadToken) return;
    if (settled === 'session-changed') {
      // The new session can store what the old one could not.
      if (reloads < SESSION_CHANGE_RELOADS) {
        currentLoad = loadWindow(around, reloads + 1);
        await currentLoad;
        return;
      }
      deviceFailed(around, trace);
      return;
    }
    // A page given up meanwhile left the device without what it shows.
    held = settled === 'held' && givenUp === givenUpBefore;
    if (!held) {
      deviceFailed(around, trace);
      return;
    }
    const fromServer = loaded.some(({ source }) => source === 'server');
    if (!fromServer) failures = 0;
    // A server page lacks what this device has not sent yet.
    if (missedReread || fromServer) scheduleReread();
    // Opening asks the server only when the channel is not proven current.
    fireAndForget(
      trace.run(() => deps.runtime.ensureCurrent(channelId)),
      'channel-local-sync'
    );
  };

  /** The message to read the window shown around; none at the live end. */
  const shownAround = () =>
    state.newerCursor === null
      ? undefined
      : (anchorId ?? middleMessageId(state.entries));

  /** Reads the window again after `wait`, or as the connection returns. */
  const readLater = (
    around: string | undefined,
    trace: TraceContext,
    watch: ReconnectWatch,
    wait: number | undefined
  ) =>
    watch.failed(
      () =>
        trace.run(() => {
          currentLoad = loadWindow(around, 1);
          fireAndForget(currentLoad, 'channel-local-sync');
        }),
      wait
    );

  /** The window shown follows nothing until it is read again. */
  const deviceFailed = (around: string | undefined, trace: TraceContext) => {
    failures += 1;
    reconnect?.stop();
    reconnect = watchReconnect();
    readLater(around, trace, reconnect, deviceRetryWait(failures));
  };

  const reread = async (trace: TraceContext) => {
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
      // Reset or evicted meanwhile: load the window again, from the server. A
      // device that keeps missing what it stored is not asked at once for
      // ever: every load's own store reports a change.
      if (failures >= SESSION_CHANGE_RELOADS) {
        held = false;
        deviceFailed(shownAround(), trace);
        return;
      }
      failures += 1;
      currentLoad = loadWindow(shownAround(), 1);
      await currentLoad;
      return;
    }
    failures = 0;
    // One that failed before this may be waiting to load the window again.
    reconnect?.stop();
    setState('olderCursor', result.olderCursor);
    setState('entries', reconcile(result.entries, { key: 'key' }));
  };

  /** Coalesces change notices into at most one reread in flight. */
  const scheduleReread = () => {
    if (rereading) {
      rereadAgain = true;
      return;
    }
    const trace = Telemetry.captureContext();
    rereading = (async () => {
      try {
        do {
          rereadAgain = false;
          await reread(trace);
        } while (rereadAgain);
      } finally {
        rereading = undefined;
      }
    })();
    fireAndForget(rereading, 'channel-local-sync');
  };
  /** A window the device could not store or read during an outage is read again. */
  const resume = () => {
    failures = 0;
    if (held) {
      if (!holds() || state.loadingOlder || state.loadingNewer)
        missedResume = true;
      return scheduleReread();
    }
    if (state.phase !== 'ready')
      return fireAndForget(load(anchorId), 'channel-local-sync');
    currentLoad = loadWindow(shownAround(), 1);
    fireAndForget(currentLoad, 'channel-local-sync');
  };
  onCleanup(
    deps.runtime.onChanged(channelId, (change) =>
      change === 'resumed' ? resume() : scheduleReread()
    )
  );

  /** Fetches the page past `cursor` and merges it into the window. */
  const fetchMore = async (
    direction: 'older' | 'newer',
    cursor: string,
    token: number,
    signal: AbortSignal,
    merged: () => void
  ) => {
    const epoch = deps.runtime.epoch();
    // A window loaded since aborts the read too: a device read may not
    // answer an abort, and the next page waits for this one to end.
    const loaded = await untilAborted(
      loadChannelPage(
        deps,
        {
          channelId,
          limit: CHANNEL_PAGE_LIMIT,
          ...(direction === 'older' ? { before: cursor } : { after: cursor }),
        },
        signal
      ),
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
    // A window loaded since aborts the wait, so paging in it starts at once.
    const settled = await settleUnlessAborted(loaded, epoch, token, signal);
    if (settled === 'aborted' || token !== loadToken) return 'stale';
    // A server page lacks what this device has not sent yet.
    if (loaded.source === 'server') missedReread = true;
    return settled;
  };

  /**
   * Reads a page of a held window again that the device did not take, as a
   * window load does: the new session can store what the old one could not.
   * `unstored` when every read again was refused too.
   */
  const fetchMoreAgain = async (
    direction: PageDirection,
    cursor: string,
    token: number,
    signal: AbortSignal,
    merged: () => void,
    trace: TraceContext
  ): Promise<'held' | 'unheld' | 'unstored' | 'stale'> => {
    for (let reloads = 0; reloads < SESSION_CHANGE_RELOADS; reloads += 1) {
      if (token !== loadToken) return 'stale';
      // After an await: the read again joins the scroll's trace.
      const settled = await trace.run(() =>
        fetchMore(direction, cursor, token, signal, merged)
      );
      if (settled !== 'session-changed') return settled;
    }
    return 'unstored';
  };

  /**
   * The window stops following the device until it is loaded again, which an
   * outage that ended meanwhile does at once.
   */
  const letGo = (trace: TraceContext) => {
    held = false;
    givenUp += 1;
    if (missedResume) return resume();
    // A failed read again of a page given up is not read on reconnect.
    for (const direction of ['older', 'newer'] as const)
      if (state.unstored[direction] !== null) pageReconnects[direction]?.stop();
    setState('unstored', { older: null, newer: null });
    deviceFailed(shownAround(), trace);
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
    // Taken before any await: a read again joins the scroll's trace.
    const trace = Telemetry.captureContext();
    let settled: Awaited<ReturnType<typeof fetchMoreAgain>>;
    if (again) {
      settled = await fetchMoreAgain(
        direction,
        cursor,
        token,
        signal,
        merged,
        trace
      );
    } else {
      const first = await fetchMore(direction, cursor, token, signal, merged);
      if (first === 'stale') return 'stale';
      if (first === 'held') return 'done';
      if (first === 'unheld' || !held) {
        letGo(trace);
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
        trace
      );
      if (settled === 'unstored') return 'unstored';
    }
    if (settled === 'stale') return 'stale';
    if (settled !== 'held') {
      letGo(trace);
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
      // One span for the page and every read of it again, so they share a
      // trace whether or not the scroll that asked had one.
      outcome = await Telemetry.span('channel.load_page', async (span) => {
        span.setAttr('channel.id', channelId);
        span.setAttr('page.direction', direction);
        span.setAttr('page.again', unstored !== null);
        const result = await pageIn(
          direction,
          cursor,
          unstored !== null,
          token,
          signal,
          merged
        );
        span.setAttr('page.outcome', result);
        return result;
      });
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
      if (holds() && missedReread) scheduleReread();
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
    // another, which stopped this call's watches.
    if (token !== loadToken) return;
    followOutcome(direction, outcome, watch);
    if (!missedResume || !holds() || state.loadingOlder || state.loadingNewer)
      return;
    missedResume = false;
    // The outage ended while a page was read that it failed.
    for (const failed of ['older', 'newer'] as const)
      if (state.pageFailed[failed])
        fireAndForget(loadMore(failed), 'channel-local-sync');
  };

  /** What a page that ended in the current window leaves to follow. */
  const followOutcome = (
    direction: PageDirection,
    outcome: PageOutcome,
    watch: ReturnType<typeof watchReconnect>
  ) => {
    // Failures in a row: one that ended otherwise starts the count again.
    const retry = pageRetries[direction];
    retry.failures = outcome === 'failed' ? retry.failures + 1 : 0;
    // A view that asked for this page again owns the watches and the wait.
    if (state[direction === 'older' ? 'loadingOlder' : 'loadingNewer']) return;
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
    isMissingTarget: () =>
      state.phase === 'failed' &&
      aroundMessageId() != null &&
      isMissingMessage(state.error),
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

function messageIdOf({ entry }: ChannelPageEntry): string | undefined {
  return entry.type === 'activity' ? undefined : entry.message.id;
}

/** A message near the middle of the window, to read it again around. */
function middleMessageId(
  entries: readonly ChannelPageEntry[]
): string | undefined {
  const middle = Math.floor(entries.length / 2);
  for (let offset = 0; offset < entries.length; offset += 1) {
    for (const index of [middle + offset, middle - offset]) {
      const entry = entries[index];
      const messageId = entry && messageIdOf(entry);
      if (messageId !== undefined) return messageId;
    }
  }
  return undefined;
}
