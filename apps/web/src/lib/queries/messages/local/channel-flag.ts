import { analytics } from '@app/lib/analytics';
import {
  enableChannelLocalSync,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/index';
import {
  getGraphqlSoupCacheHost,
  getKeptGraphqlCacheHost,
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

/**
 * Whether a host can serve channel timelines, as far as it has answered: one
 * whose database is away for now still can.
 */
function channelCacheSupported(host: CacheHost): boolean {
  if (host.disabled && !host.paused) return false;
  return !unsupportedHosts.has(host);
}

/**
 * The session's host for channels, whether or not its flag is on. A host whose
 * database is away stays it, as does one that served and is being proven
 * readable again: its queue keeps the writes, which must not go around it, and
 * the server fills what it cannot read. One that never answered is not waited
 * on while the session restarts it.
 */
export function sessionChannelHost(): CacheHost | undefined {
  const serving = graphqlCacheEnabled() ? getGraphqlSoupCacheHost() : undefined;
  const host = serving ?? getKeptGraphqlCacheHost();
  if (!host || !channelCacheSupported(host)) return undefined;
  if (!serving && !host.paused && !answeredHosts.has(host)) return undefined;
  return host;
}

export function channelCacheAnswered(host: CacheHost): boolean {
  return answeredHosts.has(host);
}

/**
 * The cache host serving channel reads and writes, or `undefined` when
 * channels stay on REST: `enable-channel-local-sync` is off or not answered
 * yet, the cache is gone, or the native engine cannot serve channel
 * timelines.
 */
export function channelCacheHost(): CacheHost | undefined {
  // No host is the common REST case and needs no flag read.
  const host = sessionChannelHost();
  if (!host || !isFeatureEnabled(enableChannelLocalSync)) return undefined;
  return host;
}

/** The host for a parent's messages: only channels read from the device. */
export function channelCacheHostFor(parent: {
  type: string;
}): CacheHost | undefined {
  return parent.type === 'channel' ? channelCacheHost() : undefined;
}

/** Calls `listener` each time feature flags load or change. */
export function onChannelFlagsChanged(listener: () => void): () => void {
  return analytics.posthog.onFeatureFlags(() => listener());
}
