import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/index';
import {
  getGraphqlSoupCacheHost,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { onlineManager } from '@tanstack/solid-query';

// Hosts whose native engine predates channel timelines stay on REST.
const unsupportedHosts = new WeakSet<CacheHost>();
// A host answers nothing until its engine has started, and a failing start can
// take minutes to give up, so only a host that has answered gets waited on.
const answeredHosts = new WeakSet<CacheHost>();

/**
 * How long a host that has not answered a channel read yet gets before the
 * channel reads from REST.
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
 * The cache host serving channel reads, or `undefined` when channels read
 * from REST: the cache rollout flag is off, the cache is unavailable, or the
 * native engine cannot serve channel timelines.
 */
export function channelCacheHost(): CacheHost | undefined {
  // No host is the common REST case and needs no flag read.
  const host = getGraphqlSoupCacheHost();
  if (!host || host.disabled || unsupportedHosts.has(host)) return undefined;
  if (!isFeatureEnabled(enableGraphqlSoup) || !graphqlCacheEnabled()) {
    return undefined;
  }
  return host;
}

/**
 * How TanStack treats a channel read while the browser is offline. With a
 * cache host the read runs anyway, because the device answers it without the
 * network; the default mode would pause it and leave the view loading.
 */
export function channelReadNetworkMode(
  parent: { type: string },
  host: CacheHost | undefined = channelCacheHost()
): 'offlineFirst' | 'online' {
  return parent.type === 'channel' && host ? 'offlineFirst' : 'online';
}

type RetryPolicy = (failureCount: number, error: Error) => boolean;

/**
 * A retry policy for reads that run offline. A read the device could not serve
 * fails while offline; that failure waits for the connection instead of
 * ending the read, and does not count against the retries `policy` allows
 * once the connection is back. Errors `policy` never retries still end it.
 */
export function retryOnceOnline(policy: RetryPolicy): RetryPolicy {
  let offlineFailures = 0;
  return (failureCount, error) => {
    if (failureCount === 0) offlineFailures = 0;
    if (!onlineManager.isOnline()) {
      if (!policy(0, error)) return false;
      offlineFailures += 1;
      return true;
    }
    return policy(failureCount - offlineFailures, error);
  };
}
