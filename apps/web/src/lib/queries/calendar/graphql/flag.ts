import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableGraphqlCalendar,
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/index';
import {
  getGraphqlSoupCacheHost,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { type Accessor, createSignal } from 'solid-js';

// Hosts whose native engine predates calendar ranges stay on REST.
const [unsupportedHosts, setUnsupportedHosts] = createSignal(
  new WeakSet<CacheHost>(),
  { equals: false }
);

export function markCalendarCacheUnsupported(host: CacheHost): void {
  setUnsupportedHosts((hosts) => hosts.add(host));
}

function calendarCacheHost(enabled: boolean): CacheHost | undefined {
  if (!enabled || !graphqlCacheEnabled()) return undefined;
  const host = getGraphqlSoupCacheHost();
  if (!host || host.disabled || unsupportedHosts().has(host)) return undefined;
  return host;
}

/**
 * The cache host serving calendar reads, or `undefined` when calendars read
 * from REST: either flag is off, the cache is unavailable, or the native
 * engine cannot serve calendar ranges.
 */
export function useGraphqlCalendarHost(): Accessor<CacheHost | undefined> {
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const graphqlCalendar = useFeatureFlag(enableGraphqlCalendar);
  return () =>
    calendarCacheHost(graphqlSoup().enabled && graphqlCalendar().enabled);
}

/** Non-reactive read of the same decision for imperative callers. */
export function graphqlCalendarHost(): CacheHost | undefined {
  return calendarCacheHost(
    isFeatureEnabled(enableGraphqlSoup) &&
      isFeatureEnabled(enableGraphqlCalendar)
  );
}
