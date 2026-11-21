import { type Accessor, createEffect, on } from 'solid-js';

/**
 * A new search starts at the top of the list, as a new tab does. While it
 * loads the previous rows stay on screen, so the reset waits for its own
 * results; resetting earlier would let them arrive at the old offset.
 */
export function createSearchScrollReset(options: {
  query: Accessor<string>;
  showsPreviousRows: Accessor<boolean>;
  reset: () => void;
}) {
  // A search still loading when the list mounts has not shown its results.
  let shownQuery = options.showsPreviousRows()
    ? undefined
    : options.query().trim();

  createEffect(
    on(
      () => [options.query().trim(), options.showsPreviousRows()] as const,
      ([query, previous]) => {
        if (previous || query === shownQuery) return;

        shownQuery = query;
        options.reset();
      }
    )
  );
}
