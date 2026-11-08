import { waitForFeatureFlag } from '@app/lib/analytics/wait-for-feature-flag';
import { enableDatabases } from '@core/constant/featureFlags';

/** A fresh deep link must wait for its remote rollout decision before loading. */
export function waitForDatabaseRollout(): Promise<boolean> {
  return waitForFeatureFlag(enableDatabases);
}
