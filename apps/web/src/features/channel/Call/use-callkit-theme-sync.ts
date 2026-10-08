import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { isPlatform, isTauri } from '@core/util/platform';
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
  const nativeCall = useNativeCallState();
  if (!ENABLE_CALLKIT || !isTauri() || !isPlatform('ios')) return null;

  const theme = createMemo(nativeCall.drawerTheme);
  createEffect(() => {
    void syncDrawerTheme(theme());
  });

  return null;
}
