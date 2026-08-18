import type { CacheRolloutCohort } from './telemetry';

export type BooleanFlag = boolean | undefined;

export type BrowserTursoCacheRolloutInput = {
  isTauri: boolean;
  graphqlTransportEnabled: boolean;
  enableEnvOverride: BooleanFlag;
  disableEnvOverride: BooleanFlag;
  posthogEnable: BooleanFlag;
  posthogDisable: BooleanFlag;
};

export type BrowserTursoCacheRolloutDecision = {
  enabled: boolean;
  cohort: CacheRolloutCohort;
  reason:
    | 'tauri-native-unchanged'
    | 'graphql-transport-disabled'
    | 'emergency-disabled'
    | 'env-enabled'
    | 'posthog-enabled'
    | 'not-enabled';
  /** Whether the caller must retain the existing native cache path. */
  nativeCacheUnchanged: boolean;
};

/**
 * Pure cache rollout policy. The emergency flag is intentionally independent from the
 * rollout flag and any true kill source wins. Undefined PostHog values fail
 * closed. Tauri returns before browser policy is considered.
 */
export function resolveBrowserTursoCacheRollout(
  input: BrowserTursoCacheRolloutInput
): BrowserTursoCacheRolloutDecision {
  if (input.isTauri) {
    return {
      enabled: input.graphqlTransportEnabled,
      cohort: 'unknown',
      reason: 'tauri-native-unchanged',
      nativeCacheUnchanged: true,
    };
  }
  if (!input.graphqlTransportEnabled) {
    return {
      enabled: false,
      cohort: 'control',
      reason: 'graphql-transport-disabled',
      nativeCacheUnchanged: false,
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
  if (input.enableEnvOverride !== undefined) {
    return {
      enabled: input.enableEnvOverride,
      cohort: input.enableEnvOverride ? 'override' : 'control',
      reason: input.enableEnvOverride ? 'env-enabled' : 'not-enabled',
      nativeCacheUnchanged: false,
    };
  }
  if (input.posthogEnable === true) {
    return {
      enabled: true,
      cohort: 'treatment',
      reason: 'posthog-enabled',
      nativeCacheUnchanged: false,
    };
  }
  return {
    enabled: false,
    cohort: 'control',
    reason: 'not-enabled',
    nativeCacheUnchanged: false,
  };
}
