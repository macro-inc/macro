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

/**
 * `useSplitNavigationHandler` for elements rendered inside an editable Lexical
 * editor, such as mention chips in a composer. Solid's `onClick`/`onMouseDown`
 * are delegated to `document`, and an editable editor's shell stops click and
 * mousedown propagation before they get there, so the delegated handlers never
 * run. Native `on:` listeners fire on the element itself, ahead of the shell.
 */
export function useNativeSplitNavigationHandler<T extends HTMLElement>(
  onClick: JSX.EventHandler<T, MouseEvent>
): {
  'on:mousedown': JSX.EventHandler<T, MouseEvent>;
  'on:click': JSX.EventHandler<T, MouseEvent>;
} {
  return {
    'on:mousedown': (e) => {
      e.preventDefault();
    },
    'on:click': onClick,
  };
}
