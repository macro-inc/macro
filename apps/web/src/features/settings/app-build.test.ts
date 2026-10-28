import { describe, expect, it } from 'vitest';
import { otaBundleDate } from './app-build';

describe('otaBundleDate', () => {
  it('dates an active OTA bundle from its build timestamp', () => {
    const built = Date.UTC(2026, 9, 27, 9, 15);
    expect(
      otaBundleDate({ bundleBuild: built, source: 'ota', nativeBuild: 42 })
    ).toEqual(new Date(built));
  });

  it('has no date while the embedded bundle runs', () => {
    expect(
      otaBundleDate({
        bundleBuild: Date.UTC(2026, 9, 1),
        source: 'embedded',
        nativeBuild: 42,
      })
    ).toBeUndefined();
  });

  it('ignores bundle builds that are counters, not timestamps', () => {
    expect(
      otaBundleDate({ bundleBuild: 100, source: 'ota', nativeBuild: 42 })
    ).toBeUndefined();
  });

  it('has no date when bundle info is unavailable', () => {
    expect(otaBundleDate(null)).toBeUndefined();
  });
});
