import {
  enableSpreadsheets,
  isFeatureEnabled,
} from '@core/constant/featureFlags';

/** Imperative rollout guard for loaders and creation, including keyboard entry points. */
export function isSpreadsheetEnabledForCurrentUser(): boolean {
  return isFeatureEnabled(enableSpreadsheets);
}
