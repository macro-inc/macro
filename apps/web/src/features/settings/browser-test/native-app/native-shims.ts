import { mockIPC } from '@tauri-apps/api/mocks';

/**
 * The native app around the page, set up before any app module loads:
 * `?platform=` (ios, android or desktop) is the app it runs in and
 * `?source=ota` runs a downloaded bundle. `nativeCommands` (also on
 * `window`) lists the commands the page sent.
 */
const params = new URLSearchParams(window.location.search);
const platform = params.get('platform') ?? 'ios';
Object.assign(window, {
  __TAURI_OS_PLUGIN_INTERNALS__: {
    os_type: platform === 'desktop' ? 'macos' : platform,
  },
});

const BUILT = Date.UTC(2026, 10, 19, 12, 0);
const BUNDLED = Date.UTC(2026, 10, 21, 9, 30);

export const nativeCommands: string[] = [];
Object.assign(window, { nativeCommands });

mockIPC((command) => {
  nativeCommands.push(command);
  if (command === 'plugin:app|version') return '2026.1119.1';
  if (command === 'get_native_build_time') return BUILT;
  if (command === 'get_bundle_debug_info') {
    const ota = params.get('source') === 'ota';
    return {
      bundleBuild: ota ? BUNDLED : BUILT,
      source: ota ? 'ota' : 'embedded',
      nativeBuild: 342,
    };
  }
  return null;
});
