import { fireAndForget } from '@core/util/fireAndForget';
import { sleep } from '@core/util/sleep';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import {
  ChannelChangesDocument,
  type ChannelChangesQuery,
} from '@service-storage/graphql/generated/graphql';
import { fetchCached } from '../../calendar/graphql/network';
import { queryClient } from '../../client';
import { messageKeys } from '../keys';
import { channelCacheHost } from './flag';
import { channelActivityKey, channelMessageKey } from './sort-key';

export type ChannelCatchUpHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit'
>;

export type ChannelChangesPage = ChannelChangesQuery['user']['channelChanges'];

/** Fetches one page of changes and resolves once it is written to the cache. */
export type FetchChannelChanges = (
  channelId: string,
  after: string
) => Promise<ChannelChangesPage>;

export type ChannelCatchUp =
  /** The device holds nothing for the channel, or cannot hold channels. */
  | { kind: 'not-held' }
  /** Nothing changed since the device's sequence. */
  | { kind: 'current'; seq: string }
  /** Changes were written; `from` is where the device was. */
  | { kind: 'applied'; from: string; seq: string }
  /** The device was too far behind and dropped the channel. */
  | { kind: 'reset' };

/** The server keeps 1000 changes replayable, 200 a page. */
const MAX_CHANGE_PAGES = 6;
/** Pushes inside this window share one request for their changes. */
const PUSH_SETTLE_MS = 250;
const MAX_PUSH_RERUNS = 3;
/** How many times one device read is made again for pushes that keep arriving. */
export const MAX_PUSH_REREADS = 3;
/** How long a device read waits for the device to take a push. */
const PUSH_STORE_WAIT_MS = 2_000;

interface ChannelSyncState {
  /** Sequence numbers pushed since the last catch-up. */
  pushed: Set<string>;
  running?: Promise<ChannelCatchUp>;
  timer?: ReturnType<typeof setTimeout>;
  /** Settled once the device has been asked to take the pushes noted so far. */
  storing?: { promise: Promise<void>; done: () => void };
}

const channels = new Map<string, ChannelSyncState>();

function stateOf(channelId: string): ChannelSyncState {
  let state = channels.get(channelId);
  if (!state) {
    state = { pushed: new Set() };
    channels.set(channelId, state);
  }
  return state;
}

const fetchChannelChanges: FetchChannelChanges = async (channelId, after) =>
  (
    await fetchCached(
      ChannelChangesDocument,
      { input: { channelId, after } },
      { hydrateOnly: true }
    )
  ).user.channelChanges;

async function storedSeq(
  host: ChannelCatchUpHost,
  channelId: string
): Promise<string | null> {
  const head = await host.channelTimeline({ channelId, limit: 1 });
  return head.kind === 'page' ? head.seq : null;
}

async function runCatchUp(
  host: ChannelCatchUpHost,
  channelId: string,
  fetchChanges: FetchChannelChanges
): Promise<ChannelCatchUp> {
  return Telemetry.span('channel.catch_up', async (span) => {
    span.setAttr('channel.id', channelId);
    const from = await storedSeq(host, channelId);
    if (from === null) {
      span.setAttr('catch_up.outcome', 'not-held');
      return { kind: 'not-held' };
    }
    let after = from;
    let changes = 0;
    for (let page = 0; page < MAX_CHANGE_PAGES; page += 1) {
      const delta = await fetchChanges(channelId, after);
      if (delta.resetRequired) break;
      changes +=
        delta.messages.length +
        delta.activities.length +
        delta.removedIds.length;
      if (delta.seq !== after || delta.removedIds.length > 0) {
        const committed = await host.channelTimelineCommit({
          channelId,
          removedKeys: delta.removedIds.flatMap((id) => [
            channelMessageKey(id),
            channelActivityKey(id),
          ]),
          ...(delta.seq !== after && {
            seq: { kind: 'advance', from: after, to: delta.seq },
          }),
        });
        if (committed.kind !== 'committed') break;
        // A page fetched meanwhile lowered the sequence: replay from there.
        if (committed.channelSeq === null) break;
        after = committed.channelSeq;
        if (after !== delta.seq) continue;
      }
      if (!delta.hasMore) {
        span.setAttr('catch_up.changes', changes);
        span.setAttr('catch_up.pages', page + 1);
        span.setAttr('catch_up.outcome', changes > 0 ? 'applied' : 'current');
        return after === from
          ? { kind: 'current', seq: after }
          : { kind: 'applied', from, seq: after };
      }
    }
    await host.channelTimelineCommit({ channelId, reset: true });
    span.setAttr('catch_up.outcome', 'reset');
    return { kind: 'reset' };
  });
}

/**
 * Brings what the device holds for a channel up to the server's sequence.
 * Concurrent callers share one run.
 */
export function catchUpChannel(
  host: ChannelCatchUpHost,
  channelId: string,
  fetchChanges: FetchChannelChanges = fetchChannelChanges
): Promise<ChannelCatchUp> {
  const state = stateOf(channelId);
  if (state.running) return state.running;
  const running = (async () => {
    try {
      return await runCatchUp(host, channelId, fetchChanges);
    } finally {
      state.running = undefined;
    }
  })();
  state.running = running;
  return running;
}

/** Whether every change in `(from, to]` also arrived as a push. */
function allPushed(state: ChannelSyncState, from: string, to: string): boolean {
  const end = BigInt(to);
  for (let seq = BigInt(from) + 1n; seq <= end; seq += 1n) {
    if (!state.pushed.has(seq.toString())) return false;
  }
  return true;
}

function forgetPushed(state: ChannelSyncState, through: string): void {
  const end = BigInt(through);
  for (const seq of state.pushed) {
    if (BigInt(seq) <= end) state.pushed.delete(seq);
  }
}

/** Re-reads the channel's loaded pages and threads, now from the device. */
export function refreshChannelViews(channelId: string): void {
  const parent = { type: 'channel' as const, id: channelId };
  queryClient.invalidateQueries({
    queryKey: [...messageKeys.messages._def, parent],
  });
  queryClient.invalidateQueries({
    queryKey: [...messageKeys.threadReplies._def, parent],
  });
}

/**
 * Catches the channel up and, when that brought anything the open views did
 * not already get as a push, has them read again.
 */
export async function catchUpAndRefresh(
  host: ChannelCatchUpHost,
  channelId: string,
  fetchChanges?: FetchChannelChanges
): Promise<ChannelCatchUp> {
  const state = stateOf(channelId);
  let outcome = await catchUpChannel(host, channelId, fetchChanges);
  let refresh = false;
  for (let run = 0; run < MAX_PUSH_RERUNS; run += 1) {
    if (outcome.kind === 'reset') {
      state.pushed.clear();
      refresh = true;
    } else if (outcome.kind === 'applied') {
      refresh ||= !allPushed(state, outcome.from, outcome.seq);
    }
    // Nothing is kept for a channel the device does not hold.
    if (outcome.kind === 'not-held') state.pushed.clear();
    if (outcome.kind !== 'applied' && outcome.kind !== 'current') break;
    forgetPushed(state, outcome.seq);
    // A push that landed after this run read the log needs another.
    if (state.pushed.size === 0) break;
    outcome = await catchUpChannel(host, channelId, fetchChanges);
  }
  if (refresh) refreshChannelViews(channelId);
  return outcome;
}

/**
 * A committed change the open views already applied from its push. The device
 * takes the same change from the server's log, so a push that was missed
 * shows up as a gap and is recovered with it.
 */
export function noteChannelPush(channelId: string, seq: number | string): void {
  const host = channelCacheHost();
  if (!host) return;
  const state = stateOf(channelId);
  state.pushed.add(String(seq));
  if (state.timer !== undefined) return;
  let done = () => {};
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  const storing = { promise, done };
  state.storing = storing;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    fireAndForget(
      storePushes(host, channelId, state, storing),
      'channel-local-sync'
    );
  }, PUSH_SETTLE_MS);
}

async function storePushes(
  host: ChannelCatchUpHost,
  channelId: string,
  state: ChannelSyncState,
  storing: NonNullable<ChannelSyncState['storing']>
): Promise<void> {
  try {
    await catchUpAndRefresh(host, channelId);
  } finally {
    // A push noted during the run has its own wait.
    if (state.storing === storing) state.storing = undefined;
    storing.done();
  }
}

/**
 * Waits until the device holds what the open views were pushed. The device
 * takes a push a moment after the views do, from the server's log, so what it
 * answers meanwhile is older than what is on screen. Resolves true when there
 * was such a push: a device read made before this resolved is to be made
 * again, not shown. `heldSeq` is the sequence that read was made at, when it
 * is known; a read at or past every pushed change is already current.
 */
export async function pushesStored(
  channelId: string,
  heldSeq?: string | null
): Promise<boolean> {
  const state = channels.get(channelId);
  const storing = state?.storing;
  if (!state || !storing) return false;
  if (heldSeq != null) {
    const held = BigInt(heldSeq);
    const ahead = [...state.pushed].some((seq) => BigInt(seq) > held);
    if (!ahead) return false;
  }
  await Promise.race([storing.promise, sleep(PUSH_STORE_WAIT_MS)]);
  return true;
}

/** Forgets every channel's sync state; for account changes and tests. */
export function resetChannelSync(): void {
  for (const state of channels.values()) {
    clearTimeout(state.timer);
    state.storing?.done();
  }
  channels.clear();
}
