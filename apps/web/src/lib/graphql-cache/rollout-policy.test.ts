import { describe, expect, it } from 'vitest';
import {
  type BooleanFlag,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

const values: BooleanFlag[] = [undefined, false, true];

describe('browser Turso cache rollout policy', () => {
  it('follows the GraphQL soup gate unless an emergency kill is active', () => {
    for (const disableEnvOverride of values) {
      for (const posthogDisable of values) {
        const decision = resolveBrowserTursoCacheRollout({
          isTauri: false,
          graphqlTransportEnabled: true,
          browserSupported: true,
          disableEnvOverride,
          posthogDisable,
        });
        const killed = disableEnvOverride === true || posthogDisable === true;
        expect(
          decision.enabled,
          JSON.stringify({ disableEnvOverride, posthogDisable })
        ).toBe(!killed);
        expect(decision.reason).toBe(
          killed ? 'emergency-disabled' : 'graphql-transport-enabled'
        );
      }
    }
  });

  it('enables browser cache when GraphQL soup is enabled', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
        graphqlTransportEnabled: true,
        browserSupported: true,
        disableEnvOverride: undefined,
        posthogDisable: undefined,
      })
    ).toEqual({
      enabled: true,
      cohort: 'treatment',
      reason: 'graphql-transport-enabled',
      nativeCacheUnchanged: false,
    });
  });

  it('does not enable a cache when the existing GraphQL transport is disabled', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
        graphqlTransportEnabled: false,
        browserSupported: true,
        disableEnvOverride: false,
        posthogDisable: false,
      })
    ).toMatchObject({
      enabled: false,
      reason: 'graphql-transport-disabled',
    });
  });

  it('keeps browsers without the cache APIs uncached', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
        graphqlTransportEnabled: true,
        browserSupported: false,
        disableEnvOverride: undefined,
        posthogDisable: undefined,
      })
    ).toEqual({
      enabled: false,
      cohort: 'unknown',
      reason: 'browser-unsupported',
      nativeCacheUnchanged: false,
    });
  });

  it.each([false, true])(
    'leaves Tauri native cache behavior equal to GraphQL transport=%s',
    (graphqlTransportEnabled) => {
      expect(
        resolveBrowserTursoCacheRollout({
          isTauri: true,
          graphqlTransportEnabled,
          browserSupported: false,
          // Browser emergency values are irrelevant on native.
          disableEnvOverride: true,
          posthogDisable: true,
        })
      ).toEqual({
        enabled: graphqlTransportEnabled,
        cohort: 'unknown',
        reason: 'tauri-native-unchanged',
        nativeCacheUnchanged: true,
      });
    }
  );
});
