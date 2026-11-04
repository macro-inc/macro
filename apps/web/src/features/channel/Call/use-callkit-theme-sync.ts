import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, createMemo } from 'solid-js';
import { setNativeCallKitDrawerTheme } from './callkit-drawer-theme';
import { useNativeCallState } from './native-call-state';

async function syncDrawerTheme(
  theme: Parameters<typeof setNativeCallKitDrawerTheme>[0]
) {
  try {
    await setNativeCallKitDrawerTheme(theme);
  } catch (err) {
    console.error('[callkit] failed to sync native drawer theme', err);
  }
}

export function useCallKitThemeSync() {
  // CallKitSync mounts this only where native calls run (iOS and Android).
  const nativeCall = useNativeCallState();
  const theme = createMemo(nativeCall.drawerTheme);
  createEffect(() => {
    fireAndForget(syncDrawerTheme(theme()), 'channel-call');
  });

  return null;
}
