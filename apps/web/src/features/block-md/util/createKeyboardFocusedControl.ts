import { onCleanup } from 'solid-js';

/**
 * Tracks the control keyboard focus landed on, which owns Enter. Read when
 * focus arrives, because Chrome makes a focused element `:focus-visible` on any
 * key press: Enter after a mouse click still moves on to the editor.
 */
export function createKeyboardFocusedControl() {
  let control: Element | undefined;
  const track = ({ target }: FocusEvent) => {
    control =
      target instanceof Element &&
      target.matches(':focus-visible') &&
      target.matches('button, a[href], [role="button"]')
        ? target
        : undefined;
  };
  document.addEventListener('focusin', track);
  onCleanup(() => document.removeEventListener('focusin', track));
  return (target: EventTarget | null | undefined) =>
    control !== undefined && target === control;
}
