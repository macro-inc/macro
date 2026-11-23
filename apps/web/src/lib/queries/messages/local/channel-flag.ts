import {
  enableChannelLocalSync,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/index';
import {
  getGraphqlSoupCacheHost,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';

// Hosts whose native engine predates channel timelines stay on REST.
const unsupportedHosts = new WeakSet<CacheHost>();
// A host answers nothing until its engine has started, and a failing start can
// take minutes to give up, so only a host that has answered gets waited on.
const answeredHosts = new WeakSet<CacheHost>();

/**
 * How long a host that has not answered a channel read yet gets before the
 * channel's first page is read from the server instead.
 */
export const CHANNEL_CACHE_HEAD_START_MS = 1_000;

export function markChannelCacheUnsupported(host: CacheHost): void {
  unsupportedHosts.add(host);
}

export function markChannelCacheAnswered(host: CacheHost): void {
  answeredHosts.add(host);
}

export function channelCacheAnswered(host: CacheHost): boolean {
  return answeredHosts.has(host);
}

/**
 * The cache host serving channel reads and writes, or `undefined` when
 * channels stay on REST: `enable-channel-local-sync` is off or not answered
 * yet, the cache is unavailable, or the native engine cannot serve channel
 * timelines.
 */
export function channelCacheHost(): CacheHost | undefined {
  // No host is the common REST case and needs no flag read.
  const host = getGraphqlSoupCacheHost();
  if (!host || host.disabled || unsupportedHosts.has(host)) return undefined;
  if (!isFeatureEnabled(enableChannelLocalSync) || !graphqlCacheEnabled()) {
    return undefined;
  }
  return host;
}

/** The host for a parent's messages: only channels read from the device. */
export function channelCacheHostFor(parent: {
  type: string;
}): CacheHost | undefined {
  return parent.type === 'channel' ? channelCacheHost() : undefined;
}
