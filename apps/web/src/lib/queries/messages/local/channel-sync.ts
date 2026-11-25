import type { CacheHost } from '@graphql-cache/index';
import {
  maySignedInUserWrite,
  queryAccountSession,
} from '@queries/auth/account-session';
import {
  ChannelChangesDocument,
  ChannelTimelineDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { channelCacheHost } from './channel-flag';
import { queryChannelNetwork, storeResult } from './channel-network';
import {
  type ChannelTouches,
  createChannelTouches,
  serverPageCoverage,
} from './channel-pages';
import { type ChannelStream, createChannelStream } from './channel-stream';
import {
  type ChannelSyncDeps,
  type ChannelSyncRuntime,
  createChannelSyncRuntime,
} from './channel-sync-runtime';
import {
  CHANNEL_PAGE_LIMIT,
  type ChannelWindows,
  createChannelWindows,
} from './channel-timeline';
import { type ChannelWrites, createChannelWrites } from './channel-writes';

const runtimes = new WeakMap<CacheHost, ChannelSyncRuntime>();
const touches = new WeakMap<CacheHost, ChannelTouches>();
const writes = new WeakMap<CacheHost, ChannelWrites>();
const windows = new WeakMap<CacheHost, ChannelWindows>();

const fetchChanges: ChannelSyncDeps['fetchChanges'] = async (
  channelId,
  after,
  signal
) => {
  const { data, cached } = await queryChannelNetwork(
    ChannelChangesDocument,
    { input: { channelId, after } },
    {
      signal,
      commit: ({ user: { channelChanges: page } }) =>
        page.resetRequired
          ? undefined
          : {
              channelId,
              seq: page.seq,
              watermark: { kind: 'advance', from: after },
              removedIds: page.removedIds,
            },
    }
  );
  return { page: data.user.channelChanges, stored: storeResult(cached) };
};

const replaceWithLatest: ChannelSyncDeps['replaceWithLatest'] = async (
  channelId,
  signal
) => {
  const { cached } = await queryChannelNetwork(
    ChannelTimelineDocument,
    { input: { channelId, limit: CHANNEL_PAGE_LIMIT } },
    {
      signal,
      commit: ({ user: { channelTimeline: page } }) => {
        const coverage = serverPageCoverage({}, page);
        return {
          channelId,
          seq: page.seq,
          reset: true,
          coverage: coverage && [coverage],
        };
      },
    }
  );
  return { stored: storeResult(cached) };
};

/**
 * The sync runtime of a cache host, made on first use. A storage reset or a
 * replaced engine makes it forget what it knew of each channel, and the
 * channels on screen are read and caught up again: the device may hold nothing
 * of them, or have failed frames and reads while its engine was away, and no
 * reconnect need follow. While the host is paused its `resumed` does that.
 */
export function channelSyncRuntime(host: CacheHost): ChannelSyncRuntime {
  const existing = runtimes.get(host);
  if (existing) return existing;
  const runtime = createChannelSyncRuntime({
    host,
    fetchChanges,
    replaceWithLatest,
  });
  host.onCacheGenerationChanged(() => {
    runtime.forgetAll();
    if (!host.paused) runtime.resumed();
  });
  runtimes.set(host, runtime);
  return runtime;
}

/** The runtime of a host that already has one; never makes one. */
export function existingChannelSyncRuntime(
  host: CacheHost
): ChannelSyncRuntime | undefined {
  return runtimes.get(host);
}

/** When each channel was last marked opened on this host, in memory. */
export function channelTouches(host: CacheHost): ChannelTouches {
  const existing = touches.get(host);
  if (existing) return existing;
  const created = createChannelTouches();
  touches.set(host, created);
  return created;
}

/**
 * Follows pushed channel changes on `client` when channels read from `host`;
 * undefined while they stay on REST.
 */
export function startChannelStream(
  client: Pick<Client, 'subscription'>,
  host: CacheHost
): ChannelStream | undefined {
  if (channelCacheHost() !== host) return undefined;
  return createChannelStream(client, channelSyncRuntime(host));
}

/** The writes of a host that already has them; never makes them. */
export function existingChannelWrites(
  host: CacheHost
): ChannelWrites | undefined {
  return writes.get(host);
}

/** The channel writes of a cache host, made on first use. */
export function channelWrites(host: CacheHost): ChannelWrites {
  const existing = writes.get(host);
  if (existing) return existing;
  const created = createChannelWrites({
    host,
    runtime: channelSyncRuntime(host),
    client: getGraphqlSoupClient,
    serving: graphqlCacheEnabled,
    signIn: queryAccountSession,
    mayWrite: maySignedInUserWrite,
  });
  writes.set(host, created);
  return created;
}

/**
 * The windows timelines on this host left as they unmounted, made on first
 * use. A new cache session forgets them.
 */
export function channelWindows(host: CacheHost): ChannelWindows {
  const existing = windows.get(host);
  if (existing) return existing;
  const created = createChannelWindows();
  host.onCacheGenerationChanged(() => created.clear());
  windows.set(host, created);
  return created;
}
