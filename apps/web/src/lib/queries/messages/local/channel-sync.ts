import type { CacheHost } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { ChannelChangesDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { channelCacheHost } from './channel-flag';
import { queryChannelNetwork } from './channel-network';
import { type ChannelTouches, createChannelTouches } from './channel-pages';
import { type ChannelStream, createChannelStream } from './channel-stream';
import {
  type ChannelChangesPage,
  type ChannelSyncRuntime,
  createChannelSyncRuntime,
} from './channel-sync-runtime';
import { type ChannelWrites, createChannelWrites } from './channel-writes';

const runtimes = new WeakMap<CacheHost, ChannelSyncRuntime>();
const touches = new WeakMap<CacheHost, ChannelTouches>();
const writes = new WeakMap<CacheHost, ChannelWrites>();

/** Reads a page of changes and resolves once its records are cached. */
async function fetchChannelChanges(
  channelId: string,
  after: string
): Promise<ChannelChangesPage> {
  const { data, cached } = await queryChannelNetwork(ChannelChangesDocument, {
    input: { channelId, after },
  });
  await cached;
  return data.user.channelChanges;
}

/**
 * The sync runtime of a cache host, made on first use. A storage reset or a
 * replaced engine makes it forget what it knew of each channel.
 */
export function channelSyncRuntime(host: CacheHost): ChannelSyncRuntime {
  const existing = runtimes.get(host);
  if (existing) return existing;
  const runtime = createChannelSyncRuntime({
    host,
    fetchChanges: fetchChannelChanges,
    generation: () => cacheSessionGeneration.capture(),
  });
  host.onCacheGenerationChanged(() => runtime.forgetAll());
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
  });
  writes.set(host, created);
  return created;
}
