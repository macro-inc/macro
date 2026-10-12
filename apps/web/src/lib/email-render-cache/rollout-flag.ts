import { analytics } from '@app/lib/analytics';
import { enableEmailRenderCache } from '@core/constant/featureFlags';
import { cacheEnabledFor } from './rollout';

/** Snapshot for module-level callers; it records no flag exposure. */
export function isEmailRenderCacheEnabled(): boolean {
  if (enableEmailRenderCache.override !== undefined)
    return enableEmailRenderCache.override;
  const result = analytics.posthog.getFeatureFlagResult?.(
    enableEmailRenderCache.key,
    { send_event: false }
  );
  return result ? cacheEnabledFor(result) : false;
}
