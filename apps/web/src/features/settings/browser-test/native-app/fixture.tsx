// First: modules below talk to Tauri as they load.
import './native-shims';
import '@fontsource-variable/inter';
import '../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { BundleUpdateStatus } from '@macro/tauri';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { NativeAppPage, type NativeAppUpdates } from '../../NativeAppPage';
import { nativeCommands } from './native-shims';

/**
 * The native app page as the apps show it, over the native shims (see
 * native-shims.ts for `?platform=` and `?source=`). `?bundle=` is the bundle
 * updater's status, `?native=Ready` a downloaded desktop app update, `?dark`
 * the dark theme.
 */
const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.dataset.themeLight = String(!dark);
document.documentElement.dataset.touchDevice = String(isTouchDevice());

function bundleStatus(status: string): BundleUpdateStatus {
  if (status === 'UpdateFound')
    return { status, data: { version: '2026.1121.1', notes: null } };
  if (status === 'Downloading') return { status, data: { progress: 42 } };
  if (status === 'Completed') return { status };
  if (status === 'WaitingForWifi') return { status };
  if (status === 'Error') return { status, data: { message: 'offline' } };
  return { status: 'Idle' };
}

const [nativeUpdateStatus] = createSignal<
  ReturnType<NativeAppUpdates['nativeUpdateStatus']>
>(
  params.get('native') === 'Ready'
    ? { status: 'Ready', data: { version: '2026.1121.1' } }
    : { status: 'Idle' }
);
const [bundleUpdateStatus] = createSignal(
  bundleStatus(params.get('bundle') ?? 'Idle')
);
const updates: NativeAppUpdates = {
  bundleUpdateStatus,
  nativeUpdateStatus,
  nativeUpdatePreparing: () => false,
  restartNativeUpdate: async () => {
    nativeCommands.push('restart_native_update');
  },
};

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <AnalyticsContextProvider>
        <PosthogProvider>
          <div class="h-dvh bg-panel text-ink">
            <NativeAppPage updates={updates} />
          </div>
        </PosthogProvider>
      </AnalyticsContextProvider>
    ),
    root
  );
