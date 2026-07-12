import { createEffect } from 'solid-js';
import { setNativeCallKitDrawerTheme } from './callkit-drawer-theme';
import { useNativeCallState } from './native-call-state';

export function useCallKitThemeSync() {
  const nativeCall = useNativeCallState();

  createEffect(() => {
    setNativeCallKitDrawerTheme(nativeCall.drawerTheme()).catch((err) =>
      console.error('[callkit] failed to sync native drawer theme', err)
    );
  });

  return null;
}
