import type { CacheRolloutCohort } from './telemetry';

export type BooleanFlag = boolean | undefined;

export type BrowserTursoCacheRolloutInput = {
  isTauri: boolean;
  graphqlTransportEnabled: boolean;
  /** Whether the browser has the worker, lock and storage APIs the cache needs. */
  browserSupported: boolean;
  disableEnvOverride: BooleanFlag;
  posthogDisable: BooleanFlag;
};

export type BrowserTursoCacheRolloutDecision = {
  enabled: boolean;
  cohort: CacheRolloutCohort;
  reason:
    | 'tauri-native-unchanged'
    | 'graphql-transport-disabled'
    | 'emergency-disabled'
    | 'browser-unsupported'
    | 'graphql-transport-enabled';
  /** Whether the caller must retain the existing native cache path. */
  nativeCacheUnchanged: boolean;
};

/**
 * Pure cache rollout policy. The GraphQL soup gate enables both transport and
 * cache. The emergency flag is independent and any true kill source wins. A
 * browser without the cache's worker and storage APIs stays uncached.
 * Tauri returns before browser policy is considered.
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
  // Outside the experiment: these browsers can only ever run uncached.
  if (!input.browserSupported) {
    return {
      enabled: false,
      cohort: 'unknown',
      reason: 'browser-unsupported',
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
