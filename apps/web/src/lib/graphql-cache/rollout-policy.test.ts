import { describe, expect, it } from 'vitest';
import {
  type BooleanFlag,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

const values: BooleanFlag[] = [undefined, false, true];

describe('browser Turso cache rollout policy', () => {
  it('is exhaustive: kill wins, explicit enable override is next, undefined fails closed', () => {
    for (const enableEnvOverride of values) {
      for (const disableEnvOverride of values) {
        for (const posthogEnable of values) {
          for (const posthogDisable of values) {
            const decision = resolveBrowserTursoCacheRollout({
              isTauri: false,
              graphqlTransportEnabled: true,
              enableEnvOverride,
              disableEnvOverride,
              posthogEnable,
              posthogDisable,
            });
            const killed =
              disableEnvOverride === true || posthogDisable === true;
            const expected = killed
              ? false
              : enableEnvOverride !== undefined
                ? enableEnvOverride
                : posthogEnable === true;
            expect(
              decision.enabled,
              JSON.stringify({
                enableEnvOverride,
                disableEnvOverride,
                posthogEnable,
                posthogDisable,
              })
            ).toBe(expected);
            if (killed) expect(decision.reason).toBe('emergency-disabled');
          }
        }
      }
    }
  });

  it('keeps production-style undefined flags off', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
        graphqlTransportEnabled: true,
        enableEnvOverride: undefined,
        disableEnvOverride: undefined,
        posthogEnable: undefined,
        posthogDisable: undefined,
      })
    ).toEqual({
      enabled: false,
      cohort: 'control',
      reason: 'not-enabled',
      nativeCacheUnchanged: false,
    });
  });

  it('does not enable a cache when the existing GraphQL transport is disabled', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
        graphqlTransportEnabled: false,
        enableEnvOverride: true,
        disableEnvOverride: false,
        posthogEnable: true,
        posthogDisable: false,
      })
    ).toMatchObject({
      enabled: false,
      reason: 'graphql-transport-disabled',
    });
  });

  it.each([false, true])(
    'leaves Tauri native cache behavior equal to GraphQL transport=%s',
    (graphqlTransportEnabled) => {
      expect(
        resolveBrowserTursoCacheRollout({
          isTauri: true,
          graphqlTransportEnabled,
          // Even contradictory browser values are irrelevant on native.
          enableEnvOverride: !graphqlTransportEnabled,
          disableEnvOverride: true,
          posthogEnable: !graphqlTransportEnabled,
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
