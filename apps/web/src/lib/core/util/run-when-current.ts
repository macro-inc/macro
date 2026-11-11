import { type Accessor, createEffect } from 'solid-js';

/** Runs an action against the list for the text on screen. A menu debounces
 * its query, so a key pressed right after typing would otherwise act on the
 * previous query's list. While `stale` the action waits for the list to catch
 * up; it is dropped if the menu stops being `active` first. */
export function createRunWhenCurrent(
  stale: Accessor<boolean>,
  active: Accessor<boolean>
) {
  let queued: (() => void) | undefined;
  createEffect(() => {
    if (!active()) {
      queued = undefined;
      return;
    }
    if (stale() || !queued) return;
    const action = queued;
    queued = undefined;
    action();
  });
  return (action: () => void) => {
    if (stale()) queued = action;
    else action();
  };
}
