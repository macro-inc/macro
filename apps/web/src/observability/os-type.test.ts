import { afterEach, describe, expect, it, vi } from 'vitest';
import { osType } from './os-type';

const { native } = vi.hoisted(() => ({
  native: { tauri: false, os: 'linux' },
}));

vi.mock('@core/util/platform', () => ({ isTauri: () => native.tauri }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => native.os }));

function browser(userAgent: string, platform?: string) {
  vi.stubGlobal('navigator', {
    userAgent,
    ...(platform !== undefined && { userAgentData: { platform } }),
  });
}

describe('osType', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    native.tauri = false;
  });

  it('reports the native OS family in the desktop and mobile apps', () => {
    native.tauri = true;
    native.os = 'macos';
    expect(osType()).toBe('darwin');
    native.os = 'windows';
    expect(osType()).toBe('windows');
    native.os = 'ios';
    expect(osType()).toBe('ios');
  });

  it('prefers client hints in browsers that send them', () => {
    browser('Mozilla/5.0 (X11; Linux x86_64)', 'macOS');
    expect(osType()).toBe('darwin');
    browser('Mozilla/5.0 (X11; CrOS x86_64)', 'Chrome OS');
    expect(osType()).toBe('chromeos');
  });

  it('falls back to the user agent family', () => {
    browser(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.6 Safari/605.1.15'
    );
    expect(osType()).toBe('darwin');
    browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0');
    expect(osType()).toBe('windows');
    browser('Mozilla/5.0 (X11; Linux x86_64) Chrome/156.0.0.0');
    expect(osType()).toBe('linux');
    browser('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/156.0.0.0');
    expect(osType()).toBe('android');
    browser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    expect(osType()).toBe('ios');
    browser('', '');
    expect(osType()).toBe('unknown');
  });
});
