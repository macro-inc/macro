import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';

/** Shared editor expansion state; sheets retain the expanded island across blur. */
export function createComposerExpansion(
  collapseOnBlur: () => boolean | undefined,
  controlsOpen: () => boolean | undefined
) {
  const [focused, setFocused] = createSignal(false);
  const [hasFocused, setHasFocused] = createSignal(false);
  const collapsed = () =>
    isTouchDevice() && collapseOnBlur() && !focused() && !controlsOpen();
  const focus = () => {
    setFocused(true);
    setHasFocused(true);
  };
  return {
    focused,
    hasFocused,
    collapsed,
    focus,
    blur: () => setFocused(false),
  };
}
