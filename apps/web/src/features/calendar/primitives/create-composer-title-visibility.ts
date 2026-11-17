import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Observe the title against the existing sheet viewport, without a second scroller. */
export function createComposerTitleVisibility(
  scrollElement: Accessor<HTMLElement | undefined>,
  titleElement: Accessor<HTMLElement | undefined>
) {
  const [compact, setCompact] = createSignal(false);
  createEffect(
    on([scrollElement, titleElement], ([scroller, title]) => {
      setCompact(false);
      if (!scroller || !title) return;
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.find((entry) => entry.target === title);
          if (entry)
            setCompact(!entry.isIntersecting && scroller.scrollTop > 0);
        },
        { root: scroller, threshold: 0 }
      );
      observer.observe(title);
      onCleanup(() => observer.disconnect());
    })
  );
  return compact;
}
