import { analytics } from '@app/lib/analytics';
import type { RemoteFlag } from '@core/constant/featureFlags';

/** Resolve a rollout before selecting a route loader; unavailable flags stay off. */
export async function waitForFeatureFlag(flag: RemoteFlag): Promise<boolean> {
  if (flag.override !== undefined) return flag.override;
  const current = analytics.posthog.isFeatureEnabled(flag.key);
  if (current !== undefined) return current;

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (enabled: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(enabled);
    };
    // Match the existing browser-observability readiness bound: a blocked
    // PostHog request leaves the feature off instead of hanging navigation.
    const timeout = setTimeout(() => finish(false), 3_000);
    unsubscribe = analytics.posthog.onFeatureFlags(
      (_flags, _variants, context) =>
        finish(
          !context?.errorsLoading &&
            (analytics.posthog.isFeatureEnabled(flag.key) ?? false)
        )
    );
    // PostHog can invoke an already-ready callback before returning its cleanup.
    if (settled) unsubscribe();
  });
}
