/**
 * Returns a keydown handler that calls `cb` when Enter is pressed.
 * Useful for elements using `onMouseDown` instead of `onClick`,
 * since keyboard activation (e.g., Enter key) doesn't trigger `mousedown`.
 *
 * @param cb - Callback to invoke on Enter key press.
 */
export const onKeyDownClick = (cb?: (e?: Event) => void) => {
  return (e: KeyboardEvent) => {
    const keyboardEvent = e as unknown as KeyboardEvent;
    if (keyboardEvent.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      cb?.(e);
    }
  };
};
/**
 * Returns a keydown handler that calls `cb` when Space is pressed.
 * Useful for elements using `onMouseDown` instead of `onClick`,
 * since keyboard activation (e.g., Enter key) doesn't trigger `mousedown`.
 *
 * @param cb - Callback to invoke on Space key press.
 */
export const onKeyUpClick = (cb?: (e?: Event) => void) => {
  return (e: KeyboardEvent) => {
    const keyboardEvent = e as unknown as KeyboardEvent;
    if (keyboardEvent.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      cb?.(e);
    }
  };
};
