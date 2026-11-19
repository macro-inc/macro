import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
} from 'solid-js';

const [isTabFocused_, setIsTabFocused] = createSignal(document.hasFocus());
const maybeSetFocus = () => setIsTabFocused(document.hasFocus());
window.addEventListener('focus', maybeSetFocus);
window.addEventListener('blur', maybeSetFocus);
window.addEventListener('visibilitychange', maybeSetFocus);

const [isTabVisible_, setIsTabVisible] = createSignal(
  document.visibilityState === 'visible'
);
document.addEventListener('visibilitychange', () =>
  setIsTabVisible(document.visibilityState === 'visible')
);

/** Whether the tab is on screen, focused or not (e.g. beside a focused window) */
export const isTabVisible = isTabVisible_;

/** Whether the tab is currently focused */
export const isTabFocused = createRoot(() =>
  createMemo(() => isTabFocused_(), {
    equalFn: (a: boolean | undefined, b: boolean | undefined) => a! === b!,
  })
);

function _createTabFocusEffect(callback: (isTabFocused: boolean) => void) {
  createEffect(
    on(isTabFocused, (curr, prev) => {
      if (curr === prev) return;
      callback(isTabFocused());
    })
  );
}
