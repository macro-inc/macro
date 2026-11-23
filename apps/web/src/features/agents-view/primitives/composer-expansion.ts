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
    // Portaled controls are still a composer interaction. Preserve logical
    // focus until they close, so their final focus handoff cannot hide the anchor.
    blur: () => {
      if (!controlsOpen()) setFocused(false);
    },
  };
}
