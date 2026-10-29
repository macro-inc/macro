import { createSignal, onCleanup } from 'solid-js';

export type MultiSelectIntent = 'add' | 'toggle' | 'only';

/** Capture selection intent before Kobalte handles a row or search input. */
export function createMultiSelectIntent() {
  const [intent, setIntent] = createSignal<MultiSelectIntent>('add');
  const track = (element: HTMLElement) => {
    const capture = (event: MouseEvent | KeyboardEvent) => {
      const checkbox =
        event.target instanceof Element &&
        event.target.closest('[data-multiselect-checkbox]');
      if (checkbox) setIntent('toggle');
      else if (event.shiftKey) setIntent('only');
      else if (event instanceof KeyboardEvent && event.key === ' ')
        setIntent('toggle');
      else setIntent('add');
    };
    element.addEventListener('pointerdown', capture, true);
    element.addEventListener('pointerup', capture, true);
    element.addEventListener('click', capture, true);
    element.addEventListener('keydown', capture, true);
    onCleanup(() => {
      element.removeEventListener('pointerdown', capture, true);
      element.removeEventListener('pointerup', capture, true);
      element.removeEventListener('click', capture, true);
      element.removeEventListener('keydown', capture, true);
    });
  };
  return { track, intent, shouldClose: () => intent() === 'add' };
}

/** Preserve other selections on row activation; Only replaces the selection. */
export function applyMultiSelectSelection(
  current: string[],
  id: string,
  intent: MultiSelectIntent
): string[] {
  if (intent === 'only') return [id];
  if (intent === 'toggle' && current.includes(id))
    return current.filter((value) => value !== id);
  return current.includes(id) ? current : [...current, id];
}
