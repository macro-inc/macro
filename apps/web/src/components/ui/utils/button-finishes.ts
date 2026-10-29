// Reuse shared elevation with Button edge colors on desktop and glass on touch.
// Pressed actions and open popup triggers flatten without moving the control.
export const raisedButtonStyles = [
  'not-touch:button-elevated touch:glass',
  'not-touch:not-data-disabled:active:shadow-none not-touch:aria-pressed:shadow-none not-touch:popup-open:shadow-none',
].join(' ');
