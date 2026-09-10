import { analytics } from '@app/lib/analytics';
import {
  disableBrowserTursoCache,
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isTauri } from '@core/util/platform';
import {
  type BrowserTursoCacheRolloutDecision,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

/** Resolves the current gate without constructing a browser cache resource. */
export function getBrowserTursoCacheRolloutDecision(): BrowserTursoCacheRolloutDecision {
  const native = isTauri();
  const graphqlTransportEnabled = isFeatureEnabled(enableGraphqlSoup);
  if (native) {
    // Do not touch browser rollout flags on Tauri. Besides preserving behavior,
    // this keeps native startup independent from PostHog browser-cache state.
    return resolveBrowserTursoCacheRollout({
      isTauri: true,
      graphqlTransportEnabled,
      disableEnvOverride: undefined,
      posthogDisable: undefined,
    });
  }

  return resolveBrowserTursoCacheRollout({
    isTauri: false,
    graphqlTransportEnabled,
    disableEnvOverride: disableBrowserTursoCache.override,
    posthogDisable: analytics.posthog.isFeatureEnabled(
      disableBrowserTursoCache.key
    ),
  });
}
