import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  type ChannelCoverageWire,
  MAX_CHANNEL_TIMELINE_PAGE,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import {
  type ChannelMessageFieldsFragment,
  ChannelMessageFieldsFragmentDoc,
  ChannelThreadDocument,
  type ChannelThreadInput,
  type ChannelThreadQuery,
} from '@service-storage/graphql/generated/graphql';
import type { Message, MessageThread } from '@service-storage/messages';
import { type Accessor, createEffect, on, onCleanup, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { markChannelCacheUnsupported } from './channel-flag';
import {
  channelMessageKey,
  mapChannelMessage,
  mapChannelRoot,
} from './channel-map';
import {
  type ChannelAnswer,
  type ChannelQueryOptions,
  type ChannelStoreResult,
  cacheSessionChanged,
  deviceRetryWait,
  isMissingMessage,
  queryChannelNetwork,
  type ReconnectWatch,
  SESSION_CHANGE_RELOADS,
  storeResult,
  viewRetryWait,
  watchReconnect,
} from './channel-network';
import type { PageStored } from './channel-pages';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

export type ChannelThreadHost = Pick<
  CacheHost,
  'channelTimeline' | 'readRecordsByKeys'
>;

export type ChannelThreadServerPage =
  ChannelThreadQuery['user']['channelThread'];

/**
 * Fetches one page of replies; resolves on arrival, before the cache holds it.
 * The cache stores what `commit` makes of the page with the page's records.
 */
export type FetchChannelThreadPage = (
  input: ChannelThreadInput,
  options: ChannelQueryOptions<ChannelThreadServerPage>
) => Promise<{
  page: ChannelThreadServerPage;
  cached: ChannelAnswer<unknown>['cached'];
}>;

/** A thread longer than this many pages reads over REST. */
const MAX_THREAD_PAGES = 100;

const fetchChannelThreadPage: FetchChannelThreadPage = async (
  input,
  { signal, commit }
) => {
  const { data, cached } = await queryChannelNetwork(
    ChannelThreadDocument,
    { input },
    {
      signal,
      commit: commit && ((data) => commit(data.user.channelThread)),
    }
  );
  return { page: data.user.channelThread, cached };
};

// Compiled on first read: the app shell imports this module before the cache.
let messageSelection: ReturnType<typeof selectRecords> | undefined;
const messageRecords = () =>
  (messageSelection ??= selectRecords(ChannelMessageFieldsFragmentDoc));

function threadOf(
  root: ChannelMessageFieldsFragment,
  replies: readonly ChannelMessageFieldsFragment[]
): MessageThread | undefined {
  const item = mapChannelRoot(root);
  if (!item) return undefined;
  const { state, thread: _preview, ...message } = item;
  return { root: message, state, replies: replies.map(mapChannelMessage) };
}

/** Reads cached messages in the order asked; undefined if any is absent. */
async function readMessages(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[]
): Promise<ChannelMessageFieldsFragment[] | undefined> {
  if (keys.length === 0) return [];
  // The engine reads at most a selection page of keys per request.
  const chunks: string[][] = [];
  for (let at = 0; at < keys.length; at += MAX_RECORD_SELECTION_PAGE_SIZE) {
    chunks.push(keys.slice(at, at + MAX_RECORD_SELECTION_PAGE_SIZE));
  }
  const reads = await Promise.all(
    chunks.map((chunk) => readRecordsByKeys(host, messageRecords(), chunk))
  );
  const byKey = new Map(
    reads.flatMap(({ records }) =>
      records.map(({ recordKey, record }) => [
        recordKey,
        record as ChannelMessageFieldsFragment,
      ])
    )
  );
  const messages: ChannelMessageFieldsFragment[] = [];
  for (const key of keys) {
    const record = byKey.get(key);
    if (!record) return undefined;
    messages.push(record);
  }
  return messages;
}

type DeviceThread =
  | { kind: 'thread'; thread: MessageThread }
  | { kind: 'miss' }
  | { kind: 'unsupported' };

/** The whole thread from the device, when it holds every reply. */
export async function readDeviceThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string
): Promise<DeviceThread> {
  const newestFirst: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const result = await host.channelTimeline({
      channelId,
      threadRootId: rootId,
      limit: MAX_CHANNEL_TIMELINE_PAGE,
      ...(before !== undefined && { before }),
    });
    if (result.kind === 'unsupported') {
      markChannelCacheUnsupported(host as CacheHost);
      return { kind: 'unsupported' };
    }
    if (!result.covered) return { kind: 'miss' };
    newestFirst.push(...result.keys);
    if (result.olderCursor === null) {
      const [roots, replies] = await Promise.all([
        readMessages(host, [channelMessageKey(rootId)]),
        readMessages(host, newestFirst.reverse()),
      ]);
      const root = roots?.[0];
      const thread = root && replies && threadOf(root, replies);
      return thread ? { kind: 'thread', thread } : { kind: 'miss' };
    }
    before = result.olderCursor;
  }
  return { kind: 'miss' };
}

/**
 * A host that cannot read, as while its database is away, sends the thread to
 * the server; `span` says so, since the device may well hold it.
 */
async function readDeviceThreadOrMiss(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string,
  span: Span
): Promise<DeviceThread> {
  try {
    return await readDeviceThread(host, channelId, rootId);
  } catch (error) {
    span.setAttr('thread.device_error', deviceErrorCode(error));
    return { kind: 'miss' };
  }
}

/** The cache's code for a failed read, or `read-failed` when it has none. */
function deviceErrorCode(error: unknown): string {
  return error instanceof Error &&
    'errorCode' in error &&
    typeof error.errorCode === 'string'
    ? error.errorCode
    : 'read-failed';
}

/** The stretch of the thread a fetched page proves complete. */
function threadPageCoverage(
  rootId: string,
  cursor: Pick<ChannelThreadInput, 'before' | 'after'>,
  page: ChannelThreadServerPage
): ChannelCoverageWire | undefined {
  const keys = page.replies.map((reply) => reply.sortKey).sort();
  const start =
    cursor.after ??
    (page.olderCursor === null ? CHANNEL_TIMELINE_START : keys[0]);
  const end =
    cursor.before ??
    (page.newerCursor === null ? CHANNEL_TIMELINE_HEAD : keys.at(-1));
  if (start === undefined || end === undefined) return undefined;
  return { threadRootId: rootId, start, end };
}

/**
 * Every reply from the server; each page is stored with the stretch of the
 * thread it proves held. Undefined for a thread too long for the device,
 * which then reads over REST. Each request starts in `span`, and an abort
 * stops the fill between pages.
 */
async function fetchServerThread(
  channelId: string,
  rootId: string,
  fetchPage: FetchChannelThreadPage,
  span: Span,
  signal?: AbortSignal
): Promise<ServerThread | undefined> {
  const ask = (cursor: Pick<ChannelThreadInput, 'before' | 'after'> = {}) => {
    signal?.throwIfAborted();
    return span.run(() =>
      fetchPage(
        { channelId, rootId, limit: MAX_CHANNEL_TIMELINE_PAGE, ...cursor },
        {
          signal,
          commit: (page) => {
            const coverage = threadPageCoverage(rootId, cursor, page);
            return {
              channelId,
              seq: page.seq,
              watermark: { kind: 'lower' },
              ...(coverage && { coverage: [coverage] }),
            };
          },
        }
      )
    );
  };
  const first = await ask();
  const replies = new Map(
    first.page.replies.map((reply) => [reply.sortKey, reply])
  );
  const stores = [storeResult(first.cached)];
  let seq = first.page.seq;
  for (const direction of ['before', 'after'] as const) {
    let cursor =
      direction === 'before' ? first.page.olderCursor : first.page.newerCursor;
    while (cursor !== null) {
      if (stores.length >= MAX_THREAD_PAGES) return undefined;
      const next = await ask({ [direction]: cursor });
      stores.push(storeResult(next.cached));
      for (const reply of next.page.replies) replies.set(reply.sortKey, reply);
      if (BigInt(next.page.seq) < BigInt(seq)) seq = next.page.seq;
      cursor =
        direction === 'before' ? next.page.olderCursor : next.page.newerCursor;
    }
  }
  // Sort keys compare bytewise in display order.
  const ordered = [...replies.keys()]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap((key) => replies.get(key) ?? []);
  const thread = threadOf(first.page.root, ordered);
  if (!thread) return undefined;
  const stored = await span.span('channel.thread.store', async (child) =>
    threadStored(await Promise.all(stores), child)
  );
  return { thread, readSeq: seq, stored };
}

/** How storing a thread's pages ended. Failures other than a session change are reported here. */
function threadStored(
  stores: readonly ChannelStoreResult[],
  span: Span
): PageStored {
  span.setAttr('thread.pages', stores.length);
  const failed = stores.flatMap((store) => (store.stored ? [] : [store.error]));
  // The cache session changed before the device stored the thread; the
  // caller reads it again under the new one.
  if (failed.some(cacheSessionChanged)) {
    span.setAttr('thread.stored', 'session-changed');
    return 'session-changed';
  }
  // The thread still shows; it is read from the server again next time.
  if (failed.length > 0) {
    span.setAttr('thread.stored', 'failed');
    span.error(failed[0]);
    Telemetry.error(failed[0], { surface: 'channel-thread' });
    return 'unheld';
  }
  const held = stores.every(
    (store) => store.stored && typeof store.outcome?.seq === 'string'
  );
  span.setAttr('thread.stored', held ? 'held' : 'unheld');
  return held ? 'held' : 'unheld';
}

interface ServerThread {
  thread: MessageThread;
  /** How storing its pages ended. */
  stored: PageStored;
  /** The sequence the server read the thread at. */
  readSeq: string;
}

export type LoadedChannelThread =
  | { source: 'device'; thread: MessageThread }
  | ({ source: 'server' } & ServerThread);

/**
 * A channel thread with all its replies: from the device when it holds the
 * thread, otherwise from the server, which then stores it. `unsupported` when
 * the device path cannot answer, so the caller reads over REST.
 */
export async function loadChannelThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string,
  options: { fetchPage?: FetchChannelThreadPage; signal?: AbortSignal } = {}
): Promise<LoadedChannelThread | 'unsupported'> {
  return Telemetry.span('channel.thread_load', async (span) => {
    span.setAttr('channel.id', channelId);
    span.setAttr('thread.root_id', rootId);
    const device = await readDeviceThreadOrMiss(host, channelId, rootId, span);
    if (device.kind === 'unsupported') {
      span.setAttr('thread.source', 'unsupported');
      return 'unsupported';
    }
    if (device.kind === 'thread') {
      span.setAttr('thread.source', 'device');
      span.setAttr('thread.replies', device.thread.replies.length);
      return { thread: device.thread, source: 'device' };
    }
    const fetched = await fetchServerThread(
      channelId,
      rootId,
      options.fetchPage ?? fetchChannelThreadPage,
      span,
      options.signal
    );
    span.setAttr('thread.source', fetched ? 'server' : 'too-long');
    if (!fetched) return 'unsupported';
    span.setAttr('thread.replies', fetched.thread.replies.length);
    return { ...fetched, source: 'server' };
  });
}

export interface ChannelThreadDeps {
  host: ChannelThreadHost;
  runtime: Pick<
    ChannelSyncRuntime,
    'open' | 'onChanged' | 'noteServerRead' | 'ensureCurrent' | 'epoch'
  >;
  fetchPage?: FetchChannelThreadPage;
  /**
   * Replies this page sent that the device does not hold yet, oldest first;
   * the thread shows them until the device's copy replaces them.
   */
  unstored?: (channelId: string, rootId: string) => readonly Message[];
}

export interface LocalChannelThread {
  /** The thread, replies oldest first; undefined until the first load answers. */
  thread(): MessageThread | undefined;
  /** Its replies alone. */
  replies(): Message[] | undefined;
  isPending(): boolean;
  error(): unknown;
  /** Loads the thread again, after a load failed. */
  retry(): Promise<void>;
}

/** Stored replies, then the ones this page sent that they do not hold yet. */
function withUnstored(
  stored: Message[],
  unstored: readonly Message[]
): Message[] {
  if (unstored.length === 0) return stored;
  const held = new Set(stored.map((reply) => reply.id));
  const missing = unstored.filter((reply) => !held.has(reply.id));
  return missing.length === 0 ? stored : [...stored, ...missing];
}

/** A read's error, as the code the app's readers know it by. */
function readError(error: unknown): unknown {
  if (!isMissingMessage(error)) return error;
  return new ThrownResultError([
    { code: 'NOT_FOUND', message: 'The thread is gone' },
  ]);
}

type ThreadState = {
  /** The root `thread` and `error` are of. */
  root: string | undefined;
  thread: MessageThread | undefined;
  error: unknown;
};

/**
 * One thread from the device, following every change the sync
 * runtime or a local write reports by reading the thread again. A thread the
 * device does not hold comes from the server, which stores it. Loads only
 * while `enabled`; owns no queryClient state. Call under a Solid owner.
 */
export function createLocalChannelThread(
  deps: ChannelThreadDeps,
  channelId: string,
  rootId: Accessor<string>,
  enabled: Accessor<boolean>,
  onUnsupported: () => void
): LocalChannelThread {
  const [state, setState] = createStore<ThreadState>({
    root: undefined,
    thread: undefined,
    error: undefined,
  });
  let token = 0;
  // The device holds the thread shown, so a change on it is read from there.
  let held = false;
  // The device changed while it did not: read once it does.
  let changed = false;
  // Reads in a row that did not leave the thread following the device.
  let failures = 0;
  // The load in flight. A reload starts after an await, outside any Solid
  // owner, so closing the thread aborts it through here, not `onCleanup`.
  let abort: AbortController | undefined;
  // Loads the thread again when the connection returns after a failed load,
  // which nothing on screen retries.
  let reconnect: ReconnectWatch | undefined;

  const show = (thread: MessageThread) =>
    setState('thread', reconcile(thread, { key: 'id' }));

  /** Loads the thread again after `wait`, or as the connection returns. */
  const loadLater = (
    root: string,
    trace: TraceContext,
    watch: ReconnectWatch,
    wait: number | undefined
  ) =>
    watch.failed(
      () => trace.run(() => fireAndForget(load(root), 'channel-thread')),
      wait
    );

  /** The thread shown follows nothing until it is loaded again. */
  const deviceFailed = (root: string, trace: TraceContext) => {
    failures += 1;
    reconnect?.stop();
    reconnect = watchReconnect();
    loadLater(root, trace, reconnect, deviceRetryWait(failures));
  };

  const load = async (root: string, reloads = 0): Promise<void> => {
    const current = ++token;
    if (untrack(() => state.root) !== root)
      setState({ root, thread: undefined, error: undefined });
    held = false;
    changed = false;
    abort?.abort();
    reconnect?.stop();
    const watch = watchReconnect();
    reconnect = watch;
    abort = new AbortController();
    const signal = abort.signal;
    // Taken before any await: the catch-up joins the open's trace.
    const trace = Telemetry.captureContext();
    const epoch = deps.runtime.epoch();
    try {
      const loaded = await loadChannelThread(deps.host, channelId, root, {
        fetchPage: deps.fetchPage,
        signal,
      });
      watch.stop();
      if (current !== token) return;
      if (loaded === 'unsupported') {
        onUnsupported();
        return;
      }
      setState('error', undefined);
      show(loaded.thread);
      if (loaded.source === 'device') {
        failures = 0;
        follow(root);
        fireAndForget(
          trace.run(() => deps.runtime.ensureCurrent(channelId)),
          'channel-thread'
        );
        return;
      }
      if (loaded.stored === 'session-changed') {
        // The new session can store what the old one could not.
        if (reloads < SESSION_CHANGE_RELOADS) await load(root, reloads + 1);
        else deviceFailed(root, trace);
        return;
      }
      deps.runtime.noteServerRead(channelId, {
        readSeq: loaded.readSeq,
        epoch,
      });
      if (loaded.stored === 'unheld') {
        deviceFailed(root, trace);
        return;
      }
      // A server thread lacks what this device has not sent yet.
      changed = true;
      follow(root);
      // A device that kept an older sequence than the read catches up.
      fireAndForget(
        trace.run(() => deps.runtime.ensureCurrent(channelId)),
        'channel-thread'
      );
    } catch (error) {
      if (current !== token) return;
      // A thread that is gone shows no more; any other failure keeps it.
      setState({
        error: readError(error),
        ...(isMissingMessage(error) && { thread: undefined }),
      });
      // The device may not hold a thread that stays shown, so it follows
      // nothing until it is read again: after a wait, too.
      const shown = untrack(() => state.thread !== undefined);
      if (shown) failures += 1;
      loadLater(
        root,
        trace,
        watch,
        shown ? viewRetryWait(failures) : undefined
      );
    }
  };

  const loadAfresh = (root: string) => {
    failures = 0;
    return load(root);
  };

  const follow = (root: string) => {
    held = true;
    if (changed) fireAndForget(reread(root), 'channel-thread');
  };

  // One reread of a load at a time; changes during it read once more after it.
  let rereading: number | undefined;
  let rereadAgain = false;
  const reread = async (root: string) => {
    if (!held) {
      changed = true;
      return;
    }
    const current = token;
    if (rereading === current) {
      rereadAgain = true;
      return;
    }
    rereading = current;
    let kind: DeviceThread['kind'] | 'stale' | undefined;
    let trace: TraceContext;
    try {
      do {
        rereadAgain = false;
        ({ kind, trace } = await readAgain(root, current));
      } while (kind === 'thread' ? rereadAgain : kind === undefined);
    } finally {
      if (rereading === current) rereading = undefined;
    }
    if (kind !== 'miss' || current !== token) return;
    // Reset or evicted meanwhile: load it again, from the server. The
    // replies shown stay until the new ones replace them. A device that
    // keeps missing what it stored is not asked at once for ever: every
    // load's own store reports a change.
    held = false;
    if (failures >= SESSION_CHANGE_RELOADS) {
      deviceFailed(root, trace);
      return;
    }
    failures += 1;
    await trace.run(() => load(root));
  };

  /**
   * Shows the device's copy, unless a load began since. No `kind` when the
   * device failed but was asked for again meanwhile, so it may answer now.
   * The trace is the reread's, for a load that follows it.
   */
  const readAgain = (root: string, current: number) =>
    Telemetry.span('channel.thread_reread', async (span) => {
      span.setAttr('channel.id', channelId);
      span.setAttr('thread.root_id', root);
      const trace = Telemetry.captureContext();
      let device: DeviceThread;
      try {
        device = await readDeviceThread(deps.host, channelId, root);
      } catch (error) {
        span.setAttr('thread.device_error', deviceErrorCode(error));
        if (current === token && rereadAgain) return { kind: undefined, trace };
        if (current === token) deviceFailed(root, trace);
        throw error;
      }
      span.setAttr('thread.source', device.kind);
      if (current !== token) return { kind: 'stale' as const, trace };
      if (device.kind === 'unsupported') onUnsupported();
      if (device.kind === 'thread') {
        failures = 0;
        // One that failed before this may be waiting to load the thread again.
        reconnect?.stop();
        show(device.thread);
      }
      return { kind: device.kind, trace };
    });

  createEffect(
    on([rootId, enabled], ([root, on]) => {
      if (!on) return;
      const release = deps.runtime.open(channelId);
      const stop = deps.runtime.onChanged(channelId, (change) =>
        fireAndForget(
          // After an outage, a thread the device could not store is loaded.
          change === 'resumed' && !held ? loadAfresh(root) : reread(root),
          'channel-thread'
        )
      );
      onCleanup(() => {
        token += 1;
        abort?.abort();
        reconnect?.stop();
        stop();
        release();
      });
      fireAndForget(loadAfresh(root), 'channel-thread');
    })
  );

  // Nothing is shown of a root the thread was on before.
  const loadedThread = () =>
    state.root === rootId() ? state.thread : undefined;
  const loadError = () => (state.root === rootId() ? state.error : undefined);

  const replies = () => {
    const thread = loadedThread();
    return (
      thread &&
      withUnstored(thread.replies, deps.unstored?.(channelId, rootId()) ?? [])
    );
  };

  return {
    thread() {
      const thread = loadedThread();
      const shown = replies();
      return thread && shown && { ...thread, replies: shown };
    },
    replies,
    isPending: () => loadedThread() === undefined && loadError() === undefined,
    error: loadError,
    retry: () => loadAfresh(untrack(rootId)),
  };
}
