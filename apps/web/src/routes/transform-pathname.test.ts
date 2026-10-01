import { transformShortIdInUrlPathname } from '@core/util/url';
import { describe, expect, it } from 'vitest';
import { transformAppPathname } from './transform-pathname';

describe('invitation route normalization', () => {
  it('preserves invite codes that also look like entity short IDs', () => {
    const code = 'WD9iagFRSqmyHgbppDaMEA';
    for (const path of [`/c/${code}`, `/app/c/${code}`]) {
      expect(transformShortIdInUrlPathname(path)).not.toBe(path);
      expect(transformAppPathname(path)).toBe(path);
    }
  });
  it('keeps expanding entity short IDs on document routes', () => {
    const path = '/app/md/WD9iagFRSqmyHgbppDaMEA';
    expect(transformAppPathname(path)).toBe(
      transformShortIdInUrlPathname(path)
    );
    expect(transformAppPathname(path)).not.toBe(path);
  });
});
