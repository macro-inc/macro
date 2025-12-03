import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

export const DEFAULT_ACTIVE_TARGET_TIME = 800;

/**
 * Creates a signal that mirrors a source signal but automatically clears
 * after a duration. Used for temporary UI states like message highlighting.
 *
 * @param source - The source signal to track
 * @param duration - Duration in milliseconds before the active state clears (default: 800ms)
 * @returns An accessor for the active target value
 *
 * @example
 * const activeId = createActiveTarget(targetId);
 * // activeId() mirrors targetId() for 800ms, then becomes undefined
 */
export function createActiveTarget<T>(
  source: Accessor<T | undefined>,
  duration = DEFAULT_ACTIVE_TARGET_TIME
): Accessor<T | undefined> {
  const [active, setActive] = createSignal<T | undefined>();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    on(source, (target) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }

      if (target !== undefined) {
        setActive(() => target);
        timeoutId = setTimeout(() => {
          setActive(undefined);
          timeoutId = undefined;
        }, duration);
      } else {
        setActive(undefined);
      }
    })
  );

  onCleanup(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });

  return active;
}
