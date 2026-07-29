// @vitest-environment jsdom

import { isTauri } from '@core/util/platform';
import { emit } from '@tauri-apps/api/event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMacroLinkInApp } from './macroLinkInterceptor';

vi.mock('@core/util/platform', () => ({
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(emit).mockClear();
});

describe('openMacroLinkInApp', () => {
  it('does nothing outside of Tauri', () => {
    expect(openMacroLinkInApp('https://dev.macro.com/app/component/abc')).toBe(
      false
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a navigate event for app links under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(
      openMacroLinkInApp('https://macro.com/app/channel/123?message=456')
    ).toBe(true);
    expect(emit).toHaveBeenCalledWith('navigate', {
      path: '/channel/123',
      query: 'message=456',
    });
  });

  it('leaves external links alone under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(openMacroLinkInApp('https://github.com/macro-inc')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to the system browser when the navigate event fails to dispatch', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(emit).mockRejectedValueOnce(new Error('ipc down'));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openMacroLinkInApp('https://macro.com/app/channel/123')).toBe(true);
    // The window.open fallback runs in the emit-rejection microtask.
    await vi.waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://macro.com/app/channel/123',
        '_blank',
        'noopener,noreferrer'
      )
    );

    openSpy.mockRestore();
  });
});
