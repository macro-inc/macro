import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CallKitDrawerTheme,
  setNativeCallKitDrawerTheme,
} from '../callkit-drawer-theme';

const bridge = vi.hoisted(() => ({
  platform: 'android',
  native: true,
  invoke: vi.fn(async () => {}),
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => bridge.native,
  isPlatform: (platform: string) => platform === bridge.platform,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
vi.mock('@theme/signals/themeReactive', () => ({ themeReactive: {} }));
const color = { red: 0.2, green: 0.3, blue: 0.4, alpha: 1 };
const theme: CallKitDrawerTheme = {
  drawerBackground: color,
  text: color,
  messageBackground: color,
  overlayBackground: color,
  edgeMuted: color,
  edge: color,
  inkMuted: color,
  failure: color,
  failureInk: color,
  success: color,
};

describe('native drawer theme bridge', () => {
  beforeEach(() => {
    bridge.platform = 'android';
    bridge.native = true;
    bridge.invoke.mockClear();
  });
  it('sends Android the theme envelope expected by its native command', async () => {
    await setNativeCallKitDrawerTheme(theme);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      'plugin:call-kit|set_call_drawer_theme',
      { theme }
    );
  });
  it('preserves the existing iOS theme argument shape', async () => {
    bridge.platform = 'ios';
    await setNativeCallKitDrawerTheme(theme);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      'plugin:call-kit|set_call_drawer_theme',
      theme
    );
  });
  it('does not invoke a native command in the browser', async () => {
    bridge.native = false;
    await setNativeCallKitDrawerTheme(theme);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
