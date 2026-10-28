import { createRenderQueue } from '@app/lib/utils/create-render-queue';
import { createSignal, onCleanup, onMount } from 'solid-js';

/** Queues each file body when its card approaches the stack viewport. */
export function createDiffReveal(scroller: () => HTMLElement) {
  const queue = createRenderQueue();
  // Keep revealed paths in memory when their bodies collapse or leave the viewport.
  const [visible, setVisible] = createSignal<ReadonlySet<string>>(new Set());
  const cards = new Map<string, HTMLElement>();
  let observer: IntersectionObserver | undefined;

  const reveal = (path: string) => {
    queue.enqueue(path, () => {
      setVisible((paths) => new Set([...paths, path]));
    });
  };

  onMount(() => {
    // Older webviews still get queued rendering, without viewport gating.
    if (typeof IntersectionObserver === 'undefined') {
      for (const path of cards.keys()) reveal(path);
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const path = (entry.target as HTMLElement).dataset.path;
          if (path) reveal(path);
          observer?.unobserve(entry.target);
        }
      },
      { root: scroller(), rootMargin: '400px 0px' }
    );
    for (const card of cards.values()) observer.observe(card);
  });
  onCleanup(() => observer?.disconnect());

  return {
    visible: (path: string) => visible().has(path),
    reveal,
    card: (path: string) => cards.get(path),
    cards: () => [...cards.values()],
    register(path: string, element: HTMLElement) {
      cards.set(path, element);
      if (observer) observer.observe(element);
      else if (typeof IntersectionObserver === 'undefined') reveal(path);
      onCleanup(() => {
        cards.delete(path);
        observer?.unobserve(element);
      });
    },
  };
}
