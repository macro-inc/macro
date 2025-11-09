import { App } from '@capacitor/app';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

const [isTabFocused_, setIsTabFocused] = createSignal(document.hasFocus());
const maybeSetFocus = () => setIsTabFocused(document.hasFocus());
createEffect(() => {
  window.addEventListener('focus', maybeSetFocus);
  window.addEventListener('blur', maybeSetFocus);
  window.addEventListener('visibilitychange', maybeSetFocus);

  onCleanup(() => {
    window.removeEventListener('focus', maybeSetFocus);
    window.removeEventListener('blur', maybeSetFocus);
    window.removeEventListener('visibilitychange', maybeSetFocus);
  });
});
if (isNativeMobilePlatform()) App.addListener('appStateChange', maybeSetFocus);

/** Whether the tab is currently focused */
export const isTabFocused = createMemo(() => isTabFocused_(), {
  equalFn: (a: boolean | undefined, b: boolean | undefined) => a! === b!,
});

export function createTabFocusEffect(
  callback: (isTabFocused: boolean) => void
) {
  createEffect(
    on(isTabFocused, (curr, prev) => {
      if (curr === prev) return;
      callback(isTabFocused());
    })
  );
}
