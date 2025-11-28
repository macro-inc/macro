import { createComputed, createEffect } from 'solid-js';

/**
 *
 * @param list pass the same list that's used for iteration component such as `<For/>`
 *
 * Restores focus on list item containing dom ref after it has been shuffled to a different index.
 *
 * Objects from list after shuffle action must be referentially stable, otherwise previous focused dom ref is destroyed therefore restoring focus fails.
 *
 */
export const createRestoreFocusOnIterationShuffle = (list: () => any[]) => {
  let previousFocusEl: HTMLElement | null = null;

  createComputed(() => {
    // tracks list append/pop or shuffle
    list();

    previousFocusEl = document.activeElement as HTMLElement;
  });

  createEffect(() => {
    // tracks list append/pop or shuffle
    list();

    if (previousFocusEl && document.activeElement === document.body) {
      previousFocusEl.focus();
    }
    previousFocusEl = null;
  });
};
