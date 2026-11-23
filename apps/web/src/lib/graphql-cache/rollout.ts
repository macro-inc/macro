import { analytics } from '@app/lib/analytics';
import { disableBrowserTursoCache } from '@core/constant/featureFlags';
import { isTauri } from '@core/util/platform';
import { unsupportedBrowserReason } from './host/browser-support';
import {
  type BrowserTursoCacheRolloutDecision,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

/** Resolves the current gate without constructing a browser cache resource. */
export function getBrowserTursoCacheRolloutDecision(): BrowserTursoCacheRolloutDecision {
  if (isTauri()) {
    // Do not touch browser rollout flags on Tauri. Besides preserving behavior,
    // this keeps native startup independent from PostHog browser-cache state.
    return resolveBrowserTursoCacheRollout({
      isTauri: true,
      browserSupported: true,
      disableEnvOverride: undefined,
      posthogDisable: undefined,
    });
  }

  return resolveBrowserTursoCacheRollout({
    isTauri: false,
    browserSupported: unsupportedBrowserReason() === undefined,
    disableEnvOverride: disableBrowserTursoCache.override,
    posthogDisable: analytics.posthog.isFeatureEnabled(
      disableBrowserTursoCache.key
    ),
  });
}
