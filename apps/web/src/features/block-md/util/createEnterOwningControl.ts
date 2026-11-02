import { onCleanup } from 'solid-js';

/**
 * Tracks the focused control, which owns Enter unless a press focused it: Enter
 * after a mouse click still moves on to the editor. A press focuses the nearest
 * focusable ancestor of what it hit. `:focus-visible` can't stand in for this,
 * because focus handed back to a control when a mouse closes its menu doesn't
 * match it, and a pressed flag can't either, because menus hand focus back
 * before the press ends.
 */
export function createEnterOwningControl() {
  let control: Element | undefined;
  let pressed: Node | null = null;
  const track = ({ target }: FocusEvent) => {
    control =
      target instanceof Element &&
      target.matches('button, a[href], [role="button"]') &&
      !target.contains(pressed)
        ? target
        : undefined;
    pressed = null;
  };
  // Clicking the focused control fires no focusin, so a press has to clear it.
  const press = ({ target }: Event) => {
    control = undefined;
    pressed = target instanceof Node ? target : null;
  };
  document.addEventListener('focusin', track);
  document.addEventListener('pointerdown', press, true);
  onCleanup(() => {
    document.removeEventListener('focusin', track);
    document.removeEventListener('pointerdown', press, true);
  });
  return (target: EventTarget | null | undefined) =>
    control !== undefined && target === control;
}
