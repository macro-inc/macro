import type { JSX } from 'solid-js';

/**
 * Wraps an onClick handler to prevent focus changes on mousedown that would
 * cause split activation flashing. This is needed when clicking on links that
 * navigate to different splits - without this, the source split briefly
 * activates on mousedown before the navigation completes.
 */
export function useSplitNavigationHandler<T extends HTMLElement>(
  onClick: JSX.EventHandler<T, MouseEvent>
): {
  onMouseDown: JSX.EventHandler<T, MouseEvent>;
  onClick: JSX.EventHandler<T, MouseEvent>;
} {
  return {
    onMouseDown: (e) => {
      e.preventDefault();
    },
    onClick,
  };
}
