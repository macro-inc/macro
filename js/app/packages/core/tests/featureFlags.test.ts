import { describe, expect, it } from 'vitest';

import { resolveFeatureFlag } from '../constant/featureFlags';

describe('resolveFeatureFlag', () => {
  it('returns the default when no env override is present', () => {
    expect(resolveFeatureFlag('TEST_FLAG_WITHOUT_OVERRIDE', true)).toBe(true);
    expect(resolveFeatureFlag('TEST_FLAG_WITHOUT_OVERRIDE', false)).toBe(false);
  });

  it('enables a flag when the env override is true', () => {
    import.meta.env.VITE_TEST_FLAG_TRUE = 'true';

    expect(resolveFeatureFlag('TEST_FLAG_TRUE', false)).toBe(true);

    delete import.meta.env.VITE_TEST_FLAG_TRUE;
  });

  it('disables a flag when the env override is false', () => {
    import.meta.env.VITE_TEST_FLAG_FALSE = 'false';

    expect(resolveFeatureFlag('TEST_FLAG_FALSE', true)).toBe(false);

    delete import.meta.env.VITE_TEST_FLAG_FALSE;
  });

  it('ignores invalid env values', () => {
    import.meta.env.VITE_TEST_FLAG_INVALID = '1';

    expect(resolveFeatureFlag('TEST_FLAG_INVALID', true)).toBe(true);
    expect(resolveFeatureFlag('TEST_FLAG_INVALID', false)).toBe(false);

    delete import.meta.env.VITE_TEST_FLAG_INVALID;
  });
});
