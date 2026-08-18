import { analytics } from '@app/lib/analytics';
import {
  DISABLE_BROWSER_TURSO_CACHE_FLAG,
  DISABLE_BROWSER_TURSO_CACHE_OVERRIDE,
  ENABLE_BROWSER_TURSO_CACHE_FLAG,
  ENABLE_BROWSER_TURSO_CACHE_OVERRIDE,
  ENABLE_GRAPHQL_SOUP,
} from '@core/constant/featureFlags';
import { isTauri } from '@core/util/platform';
import {
  type BrowserTursoCacheRolloutDecision,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

/** Resolves the current gate without constructing a browser cache resource. */
export function getBrowserTursoCacheRolloutDecision(): BrowserTursoCacheRolloutDecision {
  const native = isTauri();
  const graphqlTransportEnabled = ENABLE_GRAPHQL_SOUP();
  if (native) {
    // Do not touch browser rollout flags on Tauri. Besides preserving behavior,
    // this keeps native startup independent from PostHog browser-cache state.
    return resolveBrowserTursoCacheRollout({
      isTauri: true,
      graphqlTransportEnabled,
      enableEnvOverride: undefined,
      disableEnvOverride: undefined,
      posthogEnable: undefined,
      posthogDisable: undefined,
    });
  }

  return resolveBrowserTursoCacheRollout({
    isTauri: false,
    graphqlTransportEnabled,
    enableEnvOverride: ENABLE_BROWSER_TURSO_CACHE_OVERRIDE,
    disableEnvOverride: DISABLE_BROWSER_TURSO_CACHE_OVERRIDE,
    posthogEnable: analytics.posthog.isFeatureEnabled(
      ENABLE_BROWSER_TURSO_CACHE_FLAG
    ),
    posthogDisable: analytics.posthog.isFeatureEnabled(
      DISABLE_BROWSER_TURSO_CACHE_FLAG
    ),
  });
}
