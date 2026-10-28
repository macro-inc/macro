import { createSignal, onCleanup, onMount, Show } from 'solid-js';

const BREADCRUMB_SKELETON_DELAY_MS = 150;

export function EntityDetailBreadcrumbSkeleton() {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const timeoutId = window.setTimeout(
      () => setVisible(true),
      BREADCRUMB_SKELETON_DELAY_MS
    );
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  return (
    <Show when={visible()}>
      <div
        aria-hidden="true"
        class="flex h-7 min-w-0 items-center gap-1.5 px-1"
      >
        <span class="skeleton-shimmer size-4 shrink-0 rounded bg-skeleton" />
        <span class="skeleton-shimmer h-3 w-24 rounded-full bg-skeleton" />
      </div>
    </Show>
  );
}
