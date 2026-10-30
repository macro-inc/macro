/**
 * Whether Enter belongs to the event's target: a control reached by keyboard.
 * One focused by a click isn't `:focus-visible`, so Enter there still moves on
 * to the editor instead of pressing the control again.
 */
export function isKeyboardFocusedControl(
  target: EventTarget | null | undefined
) {
  return (
    target instanceof Element &&
    target.matches(':focus-visible') &&
    target.matches('button, a[href], [role="button"]')
  );
}
