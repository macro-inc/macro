import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGames, isFeatureEnabled } from '@core/constant/featureFlags';

/** PostHog owns rollout targeting, just like other app feature flags. */
export function useGamesAccess() {
  const flag = useFeatureFlag(enableGames);
  return () => flag().enabled;
}

/** Imperative rollout guard for loaders and creation entry points. */
export function isGamesEnabledForCurrentUser(): boolean {
  return isFeatureEnabled(enableGames);
}
