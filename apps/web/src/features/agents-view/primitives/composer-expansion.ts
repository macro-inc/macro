import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';

/** Physical focus and open controls together own the composer's interaction lifetime. */
export function createComposerExpansion(
  collapseOnBlur: () => boolean | undefined,
  controlsOpen: () => boolean | undefined
) {
  const [focusWithin, setFocusWithin] = createSignal(false);
  const focused = () => focusWithin() || Boolean(controlsOpen());
  const [hasFocused, setHasFocused] = createSignal(false);
  const collapsed = () => isTouchDevice() && collapseOnBlur() && !focused();
  const focus = () => {
    setFocusWithin(true);
    setHasFocused(true);
  };
  return {
    focused,
    hasFocused,
    collapsed,
    focus,
    // Record physical blur even while a portal holds the interaction open.
    // Releasing that hold then reflects the current focus instead of a stale bit.
    blur: () => setFocusWithin(false),
  };
}
