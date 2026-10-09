import { createSignal, onCleanup } from 'solid-js';

export type SelectionDismissal = boolean | 'unless-shift';

/** Capture before a menu/combobox handles selection, including input Enter. */
export function createSelectionDismissal() {
  const [shiftHeld, setShiftHeld] = createSignal(false);
  const track = (element: HTMLElement) => {
    const capture = (event: MouseEvent | KeyboardEvent) => {
      setShiftHeld(event.shiftKey);
      // Keep this value through the event's remaining listeners. Native browser
      // events can run microtasks between capture and Kobalte's selection handler.
    };
    element.addEventListener('pointerdown', capture, true);
    element.addEventListener('pointerup', capture, true);
    element.addEventListener('click', capture, true);
    element.addEventListener('keydown', capture, true);
    element.addEventListener('keyup', capture, true);
    onCleanup(() => {
      element.removeEventListener('pointerdown', capture, true);
      element.removeEventListener('pointerup', capture, true);
      element.removeEventListener('click', capture, true);
      element.removeEventListener('keydown', capture, true);
      element.removeEventListener('keyup', capture, true);
    });
  };
  return { track, shouldClose: () => !shiftHeld() };
}
