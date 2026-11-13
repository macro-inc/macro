import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNativeBuildDate, otaBundleDate } from './app-build';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe('getNativeBuildDate', () => {
  afterEach(() => {
    invokeMock.mockReset();
  });

  it('dates the binary from its compile timestamp', async () => {
    const built = Date.UTC(2026, 10, 1, 12, 0);
    invokeMock.mockResolvedValue(built);
    await expect(getNativeBuildDate()).resolves.toEqual(new Date(built));
    expect(invokeMock).toHaveBeenCalledWith('get_native_build_time');
  });

  it('has no date on binaries without the command', async () => {
    invokeMock.mockRejectedValue('Command get_native_build_time not found');
    await expect(getNativeBuildDate()).resolves.toBeUndefined();
  });
});

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
