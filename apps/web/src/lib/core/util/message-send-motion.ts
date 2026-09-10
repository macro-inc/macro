import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';

// Only local sends earn an entrance. Consuming the ticket prevents replays on
// virtual-list remounts, history loads, edits, and optimistic reconciliation.
const pending = new Map<string, number>();
const [revision, setRevision] = createSignal(0);
const ENTRANCE_WINDOW_MS = 5000;

export function markMessageSent(key: string) {
  const now = Date.now();
  for (const [id, expires] of pending) {
    if (expires <= now) pending.delete(id);
  }
  pending.set(key, now + ENTRANCE_WINDOW_MS);
  // Bound tickets even if a transcript never mounts.
  if (pending.size > 128) pending.delete(pending.keys().next().value!);
  setRevision((value) => value + 1);
}

/** Attach to the message, leaving the scroll/virtualizer's layout untouched. */
export function messageSendMotion(
  element: HTMLElement,
  key: Accessor<string | undefined>,
  kind: 'bubble' | 'channel'
) {
  let animation: Animation | undefined;
  onCleanup(() => animation?.cancel());
  onMount(() => {
    createEffect(() => {
      revision();
      const id = key();
      if (!id) return;
      const expires = pending.get(id);
      if (expires === undefined) return;
      pending.delete(id);
      if (
        expires <= Date.now() ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        typeof element.animate !== 'function'
      )
        return;

      animation?.cancel();
      animation = element.animate(
        kind === 'bubble'
          ? [
              {
                opacity: 0,
                transform: 'translateY(18px) scale(0.94)',
                transformOrigin: 'bottom right',
              },
              {
                opacity: 1,
                transform: 'translateY(-1px) scale(1.005)',
                transformOrigin: 'bottom right',
                offset: 0.75,
              },
              {
                opacity: 1,
                transform: 'translateY(0) scale(1)',
                transformOrigin: 'bottom right',
              },
            ]
          : [
              { opacity: 0, transform: 'translateY(10px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
        {
          duration: kind === 'bubble' ? 420 : 300,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }
      );
    });
  });
}
