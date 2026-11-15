import { describe, expect, it } from 'vitest';
import {
  type BooleanFlag,
  resolveBrowserTursoCacheRollout,
} from './rollout-policy';

const values: BooleanFlag[] = [undefined, false, true];

describe('browser Turso cache rollout policy', () => {
  it('enables the browser cache unless an emergency kill is active', () => {
    for (const disableEnvOverride of values) {
      for (const posthogDisable of values) {
        const decision = resolveBrowserTursoCacheRollout({
          isTauri: false,
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

  it('enables browser cache without an emergency kill', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: false,
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

  it('leaves Tauri native cache behavior unchanged', () => {
    expect(
      resolveBrowserTursoCacheRollout({
        isTauri: true,
        // Browser emergency values are irrelevant on native.
        disableEnvOverride: true,
        posthogDisable: true,
      })
    ).toEqual({
      enabled: true,
      cohort: 'unknown',
      reason: 'tauri-native-unchanged',
      nativeCacheUnchanged: true,
    });
  });
});
