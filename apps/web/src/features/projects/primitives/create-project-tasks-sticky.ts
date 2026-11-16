import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Observe the heading's natural position, not a scroll event on every frame. */
export function createProjectTasksSticky(
  scroller: Accessor<HTMLElement | undefined>,
  sentinel: Accessor<HTMLElement | undefined>
) {
  const [stuck, setStuck] = createSignal(false);
  createEffect(
    on([scroller, sentinel], ([root, marker]) => {
      setStuck(false);
      if (!root || !marker || typeof IntersectionObserver === 'undefined')
        return;
      let active = true;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!active) return;
          const entry = entries.find((entry) => entry.target === marker);
          if (!entry) return;
          const top = entry.rootBounds?.top ?? root.getBoundingClientRect().top;
          // An unseen marker below the viewport has not reached the sticky edge.
          setStuck(
            !entry.isIntersecting && entry.boundingClientRect.bottom <= top
          );
        },
        { root, threshold: 0 }
      );
      observer.observe(marker);
      onCleanup(() => {
        active = false;
        observer.disconnect();
      });
    })
  );
  return stuck;
}
