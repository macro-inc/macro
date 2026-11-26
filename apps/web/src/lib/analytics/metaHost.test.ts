import { describe, expect, it } from 'vitest';
import { isProductionMetaHost } from './metaHost';

describe('production Meta pixel host', () => {
  it('allows only the production site', () => {
    expect(isProductionMetaHost('macro.com')).toBe(true);
    expect(isProductionMetaHost('www.macro.com')).toBe(true);
    for (const host of [
      'dev.macro.com',
      'staging.macro.com',
      'branch-abc-preview.macro.com',
      'macro-dev.zeta.health',
      'localhost',
    ]) {
      expect(isProductionMetaHost(host)).toBe(false);
    }
  });
});
