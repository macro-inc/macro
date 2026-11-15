import type { CacheRolloutCohort } from './telemetry';

export type BooleanFlag = boolean | undefined;

export type BrowserTursoCacheRolloutInput = {
  isTauri: boolean;
  disableEnvOverride: BooleanFlag;
  posthogDisable: BooleanFlag;
};

export type BrowserTursoCacheRolloutDecision = {
  enabled: boolean;
  cohort: CacheRolloutCohort;
  reason:
    | 'tauri-native-unchanged'
    | 'emergency-disabled'
    | 'graphql-transport-enabled';
  /** Whether the caller must retain the existing native cache path. */
  nativeCacheUnchanged: boolean;
};

/**
 * Pure cache rollout policy. The cache is on unless the emergency flag kills
 * it, and any true kill source wins. Tauri returns before browser policy is
 * considered.
 */
export function resolveBrowserTursoCacheRollout(
  input: BrowserTursoCacheRolloutInput
): BrowserTursoCacheRolloutDecision {
  if (input.isTauri) {
    return {
      enabled: true,
      cohort: 'unknown',
      reason: 'tauri-native-unchanged',
      nativeCacheUnchanged: true,
    };
  }
  if (input.disableEnvOverride === true || input.posthogDisable === true) {
    return {
      enabled: false,
      cohort: 'control',
      reason: 'emergency-disabled',
      nativeCacheUnchanged: false,
    };
  }
  return {
    enabled: true,
    cohort: 'treatment',
    reason: 'graphql-transport-enabled',
    nativeCacheUnchanged: false,
  };
}
