import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  MAX_CHANNEL_TIMELINE_PAGE,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type ChannelMessageFieldsFragment,
  ChannelMessageFieldsFragmentDoc,
  ChannelThreadDocument,
  type ChannelThreadInput,
  type ChannelThreadQuery,
} from '@service-storage/graphql/generated/graphql';
import type { Message, MessageThread } from '@service-storage/messages';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  channelMessageKey,
  mapChannelMessage,
  mapChannelRoot,
} from './channel-map';
import {
  cacheSessionChanged,
  queryChannelNetwork,
  SESSION_CHANGE_RELOADS,
  storeFailure,
} from './channel-network';
import {
  afterDeletes,
  channelResetMark,
  holdAgainstDeletes,
  unchangedSince,
} from './channel-resets';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

export type ChannelThreadHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
>;

export type ChannelThreadServerPage =
  ChannelThreadQuery['user']['channelThread'];

/** Fetches one page of replies; resolves on arrival, before the cache holds it. */
export type FetchChannelThreadPage = (
  input: ChannelThreadInput,
  signal?: AbortSignal
) => Promise<{ page: ChannelThreadServerPage; cached: Promise<void> }>;

/** A thread longer than this many pages reads over REST. */
const MAX_THREAD_PAGES = 100;

const fetchChannelThreadPage: FetchChannelThreadPage = async (
  input,
  signal
) => {
  const { data, cached } = await queryChannelNetwork(
    ChannelThreadDocument,
    { input },
    signal
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
  | { kind: 'thread'; thread: MessageThread; seq: string | null }
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
  let seq: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const result = await host.channelTimeline({
      channelId,
      threadRootId: rootId,
      limit: MAX_CHANNEL_TIMELINE_PAGE,
      ...(before !== undefined && { before }),
    });
    if (result.kind === 'unsupported') return { kind: 'unsupported' };
    if (!result.covered) return { kind: 'miss' };
    if (page === 0) seq = result.seq;
    newestFirst.push(...result.keys);
    if (result.olderCursor === null) {
      const [roots, replies] = await Promise.all([
        readMessages(host, [channelMessageKey(rootId)]),
        readMessages(host, newestFirst.reverse()),
      ]);
      const root = roots?.[0];
      if (!root || !replies) return { kind: 'miss' };
      const thread = threadOf(root, replies);
      return thread ? { kind: 'thread', thread, seq } : { kind: 'miss' };
    }
    before = result.olderCursor;
  }
  return { kind: 'miss' };
}

/**
 * Every reply from the server, committed as a fully held thread once the
 * normalized cache holds the records. Undefined for a thread too long for the
 * device, which then reads over REST. Each request starts in `span`, and an
 * abort stops the fill between pages.
 */
async function fetchServerThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string,
  fetchPage: FetchChannelThreadPage,
  span: Span,
  signal?: AbortSignal
): Promise<
  | {
      thread: MessageThread;
      seq: string | null;
      readSeq: string;
      sessionChanged: boolean;
      yielded?: boolean;
    }
  | undefined
> {
  // The session the thread is read under: a later one must not store it.
  const generation = cacheSessionGeneration.capture();
  // A reset or eviction after this must not be followed by its coverage.
  const resets = channelResetMark(host, channelId);
  // Held from before the first page until the coverage is sent: no other
  // tab's delete lands between them. Null when one is pending: no coverage.
  const hold = await holdAgainstDeletes();
  try {
    return await fillThread();
  } finally {
    hold?.release();
  }

  async function fillThread() {
    const ask = (cursor: Partial<ChannelThreadInput> = {}) => {
      signal?.throwIfAborted();
      return span.run(() =>
        fetchPage(
          { channelId, rootId, limit: MAX_CHANNEL_TIMELINE_PAGE, ...cursor },
          signal
        )
      );
    };
    const first = await ask();
    const replies = new Map(
      first.page.replies.map((reply) => [reply.sortKey, reply])
    );
    const stored = [storeFailure(first.cached)];
    let seq = first.page.seq;
    let pages = 1;
    for (const direction of ['before', 'after'] as const) {
      let cursor =
        direction === 'before'
          ? first.page.olderCursor
          : first.page.newerCursor;
      while (cursor !== null) {
        if (pages >= MAX_THREAD_PAGES) return undefined;
        const next = await ask({ [direction]: cursor });
        pages += 1;
        stored.push(storeFailure(next.cached));
        for (const reply of next.page.replies)
          replies.set(reply.sortKey, reply);
        if (BigInt(next.page.seq) < BigInt(seq)) seq = next.page.seq;
        cursor =
          direction === 'before'
            ? next.page.olderCursor
            : next.page.newerCursor;
      }
    }
    // Sort keys compare bytewise in display order.
    const ordered = [...replies.keys()]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .flatMap((key) => replies.get(key) ?? []);
    const thread = threadOf(first.page.root, ordered);
    if (!thread) return undefined;
    let committed: string | null = null;
    try {
      const failed = (await Promise.all(stored)).find(Boolean);
      if (failed) throw failed.error;
      // A delete in another tab came first, or the hold ran past its limit,
      // which a reset stops waiting for: coverage would show records that
      // may be gone, and the thread reads again after the delete. Deleted
      // here, the reset rereads it itself. Nothing awaits from here to the
      // send.
      const yielded = !hold?.current();
      if (yielded || !unchangedSince(host, channelId, resets)) {
        return {
          thread,
          seq: null,
          readSeq: seq,
          sessionChanged: false,
          yielded,
        };
      }
      const result = await host.channelTimelineCommit(
        {
          channelId,
          coverage: [
            {
              threadRootId: rootId,
              start: CHANNEL_TIMELINE_START,
              end: CHANNEL_TIMELINE_HEAD,
            },
          ],
          seq: { kind: 'lower', seq },
        },
        generation
      );
      if (result.kind === 'committed') committed = result.channelSeq;
    } catch (error) {
      // The cache session changed before the device stored the thread; the
      // caller reads it again under the new one.
      if (cacheSessionChanged(error))
        return { thread, seq: null, readSeq: seq, sessionChanged: true };
      // The thread still shows; it is read from the server again next time.
      Telemetry.error(error, { surface: 'channel-thread' });
    }
    return { thread, seq: committed, readSeq: seq, sessionChanged: false };
  }
}

export type LoadedChannelThread = {
  thread: MessageThread;
  source: 'device' | 'server';
  /** The sequence the device holds for the channel; null when not stored. */
  seq: string | null;
  /** The cache session changed before the device could store the thread. */
  sessionChanged?: boolean;
  /**
   * A delete in some tab came first: the thread shows but is not held, and is
   * read again once no delete is pending (`afterDeletes`).
   */
  yielded?: boolean;
  /** The sequence the server read the thread at; absent for a device read. */
  readSeq?: string;
};

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
    const device = await readDeviceThread(host, channelId, rootId);
    if (device.kind === 'unsupported') {
      span.setAttr('thread.source', 'unsupported');
      return 'unsupported';
    }
    if (device.kind === 'thread') {
      span.setAttr('thread.source', 'device');
      span.setAttr('thread.replies', device.thread.replies.length);
      return { thread: device.thread, source: 'device', seq: device.seq };
    }
    const fetched = await fetchServerThread(
      host,
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
    | 'open'
    | 'onChanged'
    | 'noteStoredSeq'
    | 'noteServerRead'
    | 'ensureCurrent'
    | 'epoch'
  >;
  fetchPage?: FetchChannelThreadPage;
  /**
   * Replies this page sent that the device does not hold yet, oldest first;
   * the thread shows them until the device's copy replaces them.
   */
  unstored?: (channelId: string, rootId: string) => readonly Message[];
}

export interface LocalChannelThread {
  /** The replies, oldest first; undefined until the first load answers. */
  replies(): Message[] | undefined;
  isPending(): boolean;
  error(): unknown;
}

/** Stored replies, then the ones this page sent that they do not hold yet. */
function withUnstored(
  stored: Message[] | undefined,
  unstored: readonly Message[]
): Message[] | undefined {
  if (stored === undefined || unstored.length === 0) return stored;
  const held = new Set(stored.map((reply) => reply.id));
  const missing = unstored.filter((reply) => !held.has(reply.id));
  return missing.length === 0 ? stored : [...stored, ...missing];
}

type ThreadState = {
  replies: Message[] | undefined;
  error: unknown;
};

/**
 * One thread's replies from the device, following every change the sync
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
    replies: undefined,
    error: undefined,
  });
  let token = 0;
  let held = false;
  // The load in flight. A reload starts after an await, outside any Solid
  // owner, so closing the thread aborts it through here, not `onCleanup`.
  let abort: AbortController | undefined;

  const show = (thread: MessageThread) =>
    setState('replies', reconcile(thread.replies, { key: 'id' }));

  const load = async (root: string, reloads = 0): Promise<void> => {
    const current = ++token;
    held = false;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const epoch = deps.runtime.epoch();
    try {
      const loaded = await loadChannelThread(deps.host, channelId, root, {
        fetchPage: deps.fetchPage,
        signal,
      });
      if (current !== token) return;
      if (loaded === 'unsupported') {
        onUnsupported();
        return;
      }
      setState('error', undefined);
      show(loaded.thread);
      if (loaded.source === 'device') {
        deps.runtime.noteStoredSeq(channelId, loaded.seq);
        held = true;
        fireAndForget(deps.runtime.ensureCurrent(channelId), 'channel-thread');
        return;
      }
      if (loaded.sessionChanged || loaded.yielded) {
        // The new session can store what the old one could not, and a read
        // after the delete can hold what it reads.
        if (reloads >= SESSION_CHANGE_RELOADS) return;
        if (loaded.yielded && !(await afterDeletes(signal))) return;
        if (current === token) await load(root, reloads + 1);
        return;
      }
      deps.runtime.noteServerRead(
        channelId,
        loaded.seq,
        epoch,
        loaded.readSeq ?? null
      );
      held = loaded.seq !== null;
      // A device that kept an older sequence than the read catches up.
      if (held)
        fireAndForget(deps.runtime.ensureCurrent(channelId), 'channel-thread');
    } catch (error) {
      if (current !== token) return;
      setState('error', error);
    }
  };

  // One reread at a time; changes during it read once more after it.
  let rereading = false;
  let rereadAgain = false;
  const reread = async (root: string) => {
    if (!held) return;
    if (rereading) {
      rereadAgain = true;
      return;
    }
    rereading = true;
    try {
      do {
        rereadAgain = false;
        const current = token;
        const device = await readDeviceThread(deps.host, channelId, root);
        if (current !== token) return;
        if (device.kind === 'unsupported') {
          onUnsupported();
          return;
        }
        if (device.kind === 'miss') {
          // Reset or evicted meanwhile: load it again, from the server. The
          // replies shown stay until the new ones replace them.
          await load(root);
          return;
        }
        show(device.thread);
      } while (rereadAgain);
    } finally {
      rereading = false;
    }
  };

  createEffect(
    on([rootId, enabled], ([root, on]) => {
      if (!on) return;
      const release = deps.runtime.open(channelId);
      const stop = deps.runtime.onChanged(channelId, () =>
        fireAndForget(reread(root), 'channel-thread')
      );
      onCleanup(() => {
        token += 1;
        abort?.abort();
        stop();
        release();
      });
      fireAndForget(load(root), 'channel-thread');
    })
  );

  return {
    replies: () =>
      withUnstored(state.replies, deps.unstored?.(channelId, rootId()) ?? []),
    isPending: () => state.replies === undefined && state.error === undefined,
    error: () => state.error,
  };
}
