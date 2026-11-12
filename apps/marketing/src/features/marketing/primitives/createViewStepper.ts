import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

const STEP_MS = 3200;

/**
 * The view a switchable graphic shows. It steps through `views` while `root`
 * is on screen, and stops for good once someone chooses a view themselves.
 */
export function createViewStepper<View extends string>(
  views: readonly View[],
  root: () => Element | undefined
): { view: Accessor<View>; choose: (view: View) => void } {
  const [view, setView] = createSignal<View>(views[0]);
  let timer: number | undefined;
  let chosen = false;

  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  onMount(() => {
    const element = root();
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Only step while the graphic is on screen, so it starts from the first view.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return stop();
      if (chosen || timer !== undefined) return;

      timer = window.setInterval(() => {
        const next = views.indexOf(view()) + 1;
        setView(() => views[next % views.length]);
      }, STEP_MS);
    });
    observer.observe(element);

    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  return {
    view,
    choose: (next) => {
      chosen = true;
      stop();
      setView(() => next);
    },
  };
}
