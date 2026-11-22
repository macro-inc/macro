/**
 * Compares the cached channel directory with the REST channel list the app
 * still loads, so production shows whether the directory can replace it
 * before any reader moves. It reports counts only: no channel ids, names or
 * people.
 */
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { hashKey } from '@tanstack/solid-query';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
} from '../contacts/cache-scope';
import {
  listCachedChannelDocuments,
  readDirectoryChannels,
} from './directory-cache';
import {
  compareChannelDirectory,
  type DirectoryChannel,
  type DirectoryDifferenceKind,
} from './directory-core';
import { channelKeys } from './keys';

const READ_BATCH = 500;
// The REST list loads alongside the lane; give a large account's 150 pages
// time to finish.
const REST_WAIT_MS = 5 * 60_000;
// Server timestamps against the client's fetch time: allow for clock skew.
const CHANGE_MARGIN_MS = 60_000;
const NEVER_ABORTED = new AbortController().signal;

type ShadowHost = Pick<
  CacheHost,
  'search' | 'readRecordsByKeys' | 'readQuery' | 'currentStorageGeneration'
>;

/** The REST channel list as loaded, and when its data was last written. */
export type RestChannelList = {
  channels: readonly ApiChannelWithLatest[];
  fetchedAt: number;
};

export type DirectoryShadowSummary = {
  restChannels: number;
  /** Channel records the cache lists, joined or not. */
  cachedChannels: number;
  joined: number;
  /** Public or team channels the viewer opened without joining. */
  unjoined: number;
  /** Records lacking a directory field. */
  incomplete: number;
  /** Joined channels that changed after the REST list was read, so they are
   * not compared field by field. */
  changedSinceRest: number;
  /** Channels with at least one difference. */
  differingChannels: number;
  differences: Partial<Record<DirectoryDifferenceKind, number>>;
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    result.push(items.slice(offset, offset + size));
  return result;
}

/** The newest time anything on the record changed. */
function lastChangedAt(channel: DirectoryChannel): number {
  const times = [
    channel.createdAt,
    channel.updatedAt,
    channel.viewedAt,
    channel.interactedAt,
    channel.latestMessage?.updatedAt,
    channel.latestNonThreadMessage?.updatedAt,
    ...channel.participants.flatMap(({ joinedAt, leftAt }) => [
      joinedAt,
      leftAt,
    ]),
    ...channel.botParticipants.flatMap(({ joinedAt, leftAt }) => [
      joinedAt,
      leftAt,
    ]),
  ];
  let latest = 0;
  for (const time of times) {
    if (time) latest = Math.max(latest, Date.parse(time));
  }
  return latest;
}

/**
 * Compares every cached channel the viewer joined with the REST list, reading
 * the cache 500 records at a time so a large account never holds the whole
 * directory beside the list.
 */
export async function compareCachedDirectoryWithRest(
  host: Pick<CacheHost, 'search' | 'readRecordsByKeys'>,
  rest: RestChannelList,
  signal?: AbortSignal
): Promise<DirectoryShadowSummary> {
  const restById = new Map(
    rest.channels.map((channel) => [channel.id, channel])
  );
  const documents = await listCachedChannelDocuments(host, signal);
  const joinedIds = new Set<string>();
  const differing = new Set<string>();
  const differences: Partial<Record<DirectoryDifferenceKind, number>> = {};
  const count = (kind: DirectoryDifferenceKind, channelId: string) => {
    differences[kind] = (differences[kind] ?? 0) + 1;
    differing.add(channelId);
  };
  let unjoined = 0;
  let incomplete = 0;
  let changedSinceRest = 0;
  const changedAfter = rest.fetchedAt - CHANGE_MARGIN_MS;

  for (const keys of chunks(
    documents.map(({ recordKey }) => recordKey),
    READ_BATCH
  )) {
    const read = await readDirectoryChannels(host, keys, signal);
    incomplete += keys.length - read.size;
    const compared: DirectoryChannel[] = [];
    const restSide: ApiChannelWithLatest[] = [];
    for (const channel of read.values()) {
      if (!channel.isParticipant) {
        unjoined += 1;
        continue;
      }
      joinedIds.add(channel.id);
      if (lastChangedAt(channel) > changedAfter) {
        changedSinceRest += 1;
        continue;
      }
      compared.push(channel);
      const restChannel = restById.get(channel.id);
      if (restChannel) restSide.push(restChannel);
    }
    for (const { kind, channelId } of compareChannelDirectory(
      restSide,
      compared
    ))
      count(kind, channelId);
  }
  for (const id of restById.keys()) {
    if (!joinedIds.has(id)) count('missing_from_directory', id);
  }

  return {
    restChannels: restById.size,
    cachedChannels: documents.length,
    joined: joinedIds.size,
    unjoined,
    incomplete,
    changedSinceRest,
    differingChannels: differing.size,
    differences,
  };
}

/** The viewer's REST channel list once it has loaded and is not refetching. */
function readyRestChannelList(userId: string): RestChannelList | undefined {
  const state = queryClient.getQueryState<ApiChannelWithLatest[]>(
    channelKeys.listChannels(userId).queryKey
  );
  if (state?.status !== 'success' || state.fetchStatus !== 'idle') return;
  if (!state.data) return;
  return { channels: state.data, fetchedAt: state.dataUpdatedAt };
}

/** Waits for the REST channel list the app loads at startup; never starts a
 * fetch of its own. Undefined when it does not settle in time. */
export function waitForRestChannelList(
  userId: string,
  timeoutMs = REST_WAIT_MS
): Promise<RestChannelList | undefined> {
  const ready = readyRestChannelList(userId);
  if (ready) return Promise.resolve(ready);
  const hash = hashKey(channelKeys.listChannels(userId).queryKey);
  return new Promise((resolve) => {
    const finish = (list: RestChannelList | undefined) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(list);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== hash) return;
      const list = readyRestChannelList(userId);
      if (list) finish(list);
    });
  });
}

export type ShadowScope = {
  host: ShadowHost;
  userId: string;
  generation: string;
};

async function stillInScope(scope: ShadowScope): Promise<boolean> {
  try {
    await assertContactCacheScope(
      scope.host,
      scope.userId,
      scope.generation,
      NEVER_ABORTED
    );
    return true;
  } catch (error) {
    if (error instanceof ContactDirectoryScopeError) return false;
    throw error;
  }
}

const comparedViewers = new Set<string>();

/**
 * Compares the directory with the REST list once per viewer in this tab,
 * after the channel lane finished a pass and removed what it proved stale.
 * Records one `channel_directory.shadow` span of counts.
 */
export async function shadowCompareChannelDirectory(
  scope: ShadowScope,
  restList: (
    userId: string
  ) => Promise<RestChannelList | undefined> = waitForRestChannelList
): Promise<void> {
  if (comparedViewers.has(scope.userId)) return;
  comparedViewers.add(scope.userId);
  const rest = await restList(scope.userId);
  await Telemetry.span('channel_directory.shadow', async (span) => {
    if (!rest) {
      span.setAttr('channel_directory.shadow_outcome', 'rest_unavailable');
      return;
    }
    span.setAttr(
      'channel_directory.rest_age_ms',
      Math.max(0, Date.now() - rest.fetchedAt)
    );
    const summary = await compareCachedDirectoryWithRest(scope.host, rest);
    if (!(await stillInScope(scope))) {
      span.setAttr('channel_directory.shadow_outcome', 'scope_changed');
      return;
    }
    span.setAttr('channel_directory.shadow_outcome', 'complete');
    span.setAttr('channel_directory.rest_channels', summary.restChannels);
    span.setAttr('channel_directory.cached_channels', summary.cachedChannels);
    span.setAttr('channel_directory.joined', summary.joined);
    span.setAttr('channel_directory.unjoined', summary.unjoined);
    span.setAttr('channel_directory.incomplete', summary.incomplete);
    span.setAttr(
      'channel_directory.changed_since_rest',
      summary.changedSinceRest
    );
    span.setAttr(
      'channel_directory.differing_channels',
      summary.differingChannels
    );
    for (const [kind, total] of Object.entries(summary.differences))
      span.setAttr(`channel_directory.diff.${kind}`, total);
  });
}
