import { analytics } from '@app/lib/analytics';
import { enableDatabases } from '@core/constant/featureFlags';

/** A fresh deep link must wait for its remote rollout decision before loading. */
export async function waitForDatabaseRollout(): Promise<boolean> {
  if (enableDatabases.override !== undefined) return enableDatabases.override;
  const current = analytics.posthog.isFeatureEnabled(enableDatabases.key);
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
    unsubscribe = analytics.posthog.onFeatureFlags((_flags, _variants, ctx) =>
      finish(
        !ctx?.errorsLoading &&
          (analytics.posthog.isFeatureEnabled(enableDatabases.key) ?? false)
      )
    );
    // PostHog can invoke an already-ready callback before returning its cleanup.
    if (settled) unsubscribe();
  });
}
