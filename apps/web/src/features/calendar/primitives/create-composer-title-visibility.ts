import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

const TITLE_FADE_DISTANCE = 24;

/** The first title line crosses the viewport over a reversible 24px ramp. */
function composerTitleProgress(scrollOffset: number, titleOffset: number) {
  return Math.max(
    0,
    Math.min(1, (scrollOffset - titleOffset) / TITLE_FADE_DISTANCE)
  );
}

/** Follow the existing scroller without inserting or resizing its chrome. */
export function createComposerTitleVisibility(
  scrollElement: Accessor<HTMLElement | undefined>,
  titleElement: Accessor<HTMLElement | undefined>
) {
  const [progress, setProgress] = createSignal(0);
  createEffect(
    on([scrollElement, titleElement], ([scroller, title]) => {
      setProgress(0);
      if (!scroller || !title) return;
      let frame: number | undefined;
      const measure = () => {
        frame = undefined;
        const viewportTop =
          scroller.getBoundingClientRect().top + scroller.clientTop;
        const titleBounds = title.getBoundingClientRect();
        const lineHeight = Number.parseFloat(
          getComputedStyle(title).lineHeight
        );
        // Wait for the first line to leave, not the whole multiline field.
        // Otherwise both full and compact titles remain readable together.
        const firstLineHeight = Number.isFinite(lineHeight)
          ? Math.min(lineHeight, titleBounds.height)
          : titleBounds.height;
        const titleOffset =
          titleBounds.top - viewportTop + scroller.scrollTop + firstLineHeight;
        setProgress(composerTitleProgress(scroller.scrollTop, titleOffset));
      };
      const schedule = () => {
        if (frame === undefined) frame = requestAnimationFrame(measure);
      };
      const observer = new ResizeObserver(schedule);
      observer.observe(scroller);
      observer.observe(title);
      scroller.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      schedule();
      onCleanup(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        observer.disconnect();
        scroller.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
      });
    })
  );
  return progress;
}
