import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Tracks whether an element is in (or near) the viewport. Used to pause
 * continuous animations — rAF loops and infinite CSS animations — while their
 * scene is offscreen, instead of burning main-thread time for content nobody
 * can see. The rootMargin pre-starts animations slightly before they scroll
 * into view so motion is already running when they appear.
 */
export function createVisible(
  getElement: () => Element | undefined,
  rootMargin = '160px'
): Accessor<boolean> {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const element = getElement();
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin }
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  return visible;
}
