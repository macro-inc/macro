import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeCallEnabled } from '../native-call-platform';

const platform = vi.hoisted(() => ({
  os: 'android',
  version: '16',
  native: true,
  enabled: true,
}));
vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_CALLKIT() {
    return platform.enabled;
  },
}));
vi.mock('@core/util/platform', () => ({
  isTauri: () => platform.native,
  isPlatform: (os: string) => os === platform.os,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ version: () => platform.version }));

describe('native call binary compatibility', () => {
  beforeEach(() => {
    platform.os = 'android';
    platform.version = '16';
    platform.native = true;
    platform.enabled = true;
    delete window.__MACRO_ANDROID_CALL_KIT__;
  });
  afterEach(() => {
    delete window.__MACRO_ANDROID_CALL_KIT__;
  });
  it('keeps older Android APKs on browser media even with a new frontend', () => {
    expect(isNativeCallEnabled()).toBe(false);
  });
  it('enables native calling only when the binary advertises the plugin', () => {
    window.__MACRO_ANDROID_CALL_KIT__ = true;
    expect(isNativeCallEnabled()).toBe(true);
  });
  it.each(['7.0', '7.1.2', 'unknown'])(
    'preserves browser calling on unsupported Android %s',
    (version) => {
      window.__MACRO_ANDROID_CALL_KIT__ = true;
      platform.version = version;
      expect(isNativeCallEnabled()).toBe(false);
    }
  );
  it('supports the minimum Telecom version, Android 8', () => {
    window.__MACRO_ANDROID_CALL_KIT__ = true;
    platform.version = '8.0.0';
    expect(isNativeCallEnabled()).toBe(true);
  });
  it('leaves iOS native behavior independent of the Android capability', () => {
    platform.os = 'ios';
    expect(isNativeCallEnabled()).toBe(true);
  });
  it.each(['web', 'desktop'])(
    'keeps %s calling in the browser session',
    (os) => {
      window.__MACRO_ANDROID_CALL_KIT__ = true;
      platform.os = os;
      expect(isNativeCallEnabled()).toBe(false);
    }
  );
  it('honors the existing native calling feature flag', () => {
    platform.os = 'ios';
    platform.enabled = false;
    expect(isNativeCallEnabled()).toBe(false);
  });
});
