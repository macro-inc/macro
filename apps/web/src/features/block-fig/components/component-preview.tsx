/** Load a component thumbnail only when its card approaches the viewport. */
import DiamondsFour from '@phosphor/diamonds-four.svg';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

export function ComponentPreview(props: { load: () => Promise<Blob> }) {
  let host!: HTMLSpanElement;
  let disposed = false;
  const [url, setUrl] = createSignal<string>();
  const load = async () => {
    try {
      const blob = await props.load();
      if (!disposed) setUrl(URL.createObjectURL(blob));
    } catch {
      // A component without drawable content keeps its component icon.
    }
  };
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void load();
      },
      { rootMargin: '64px' }
    );
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    disposed = true;
    const current = url();
    if (current) URL.revokeObjectURL(current);
  });
  return (
    <span
      ref={host}
      data-testid="fig-asset-preview"
      class="flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-inset p-3"
    >
      <Show
        when={url()}
        fallback={<DiamondsFour class="size-5 text-ink-muted" />}
      >
        {(src) => (
          <img
            src={src()}
            alt=""
            class="max-h-full max-w-full object-contain"
          />
        )}
      </Show>
    </span>
  );
}
