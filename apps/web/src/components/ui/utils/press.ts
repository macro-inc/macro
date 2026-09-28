/**
 * Handlers for a control that acts on press rather than release: `activate`
 * runs on primary-button mousedown, so the result lands the instant the button
 * goes down. The click that follows is a no-op, but a click with no preceding
 * mousedown still activates: keyboard activation (`detail` is 0 for those), or
 * a trackpad tap whose mousedown never reached us. Spread onto a button.
 */
export function pressHandlers(activate: (event: MouseEvent) => void) {
  let pressHandled = false;

  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 0) return;
      pressHandled = true;
      activate(event);
    },
    onClick: (event: MouseEvent) => {
      const handled = pressHandled;
      pressHandled = false;
      if (event.button !== 0) return;
      if (handled && event.detail !== 0) return;
      activate(event);
    },
  };
}
