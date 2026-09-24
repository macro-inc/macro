import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { preloadHomepageDemo } from './preloadHomepageDemo';

/** Warm code in the background; only nearby demos mount their editors. */
export function DeferredDemo(props: {
  children: JSX.Element;
  fallback: JSX.Element;
  preload: () => Promise<unknown>;
}) {
  let host!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);
  onMount(() => {
    onCleanup(preloadHomepageDemo(props.preload));
    // The journey scrolls inside its shell. A viewport-rooted observer would
    // have its preload margin clipped by that scroll container.
    let scrollRoot = host.parentElement;
    while (
      scrollRoot &&
      !/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY)
    ) {
      scrollRoot = scrollRoot.parentElement;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: '1400px 0px' }
    );
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div ref={host} data-deferred-demo>
      <Show when={ready()} fallback={props.fallback}>
        <Suspense fallback={props.fallback}>{props.children}</Suspense>
      </Show>
    </div>
  );
}

/** Quiet, stable space for a demo if the reader outruns its background load. */
export function DemoPlaceholder(props: { label: string }) {
  return (
    <div
      class="homepage-compose-loading workspace-demo rounded-2xl border border-edge-muted bg-panel/20 px-6 py-5"
      role="img"
      aria-label={props.label}
    >
      <div class="w-full self-start opacity-30" aria-hidden="true">
        <div class="mb-7 h-2 w-28 rounded bg-ink/20" />
        <div class="mb-7 h-px w-full bg-edge" />
        <div class="mb-4 h-2 w-3/4 rounded bg-ink/10" />
        <div class="mb-4 h-2 w-full rounded bg-ink/10" />
        <div class="h-2 w-1/2 rounded bg-ink/10" />
      </div>
    </div>
  );
}
