import { ReactiveMap } from '@solid-primitives/map';
import { type Accessor, createEffect, on, onCleanup, untrack } from 'solid-js';

const ENTRANCE_WINDOW_MS = 5000;
const MAX_PENDING_SENDS = 128;

// A send can be marked before or after its message mounts. Consume each marker
// once so history loads, virtual-list remounts, and other splits don't replay it.
const pendingSends = new ReactiveMap<string, number>();

export function markMessageSent(key: string) {
  untrack(() => {
    const now = Date.now();
    for (const [id, expires] of pendingSends) {
      if (expires <= now) pendingSends.delete(id);
    }
    pendingSends.set(key, now + ENTRANCE_WINDOW_MS);
    // Bound markers even if a transcript never mounts.
    if (pendingSends.size > MAX_PENDING_SENDS)
      pendingSends.delete(pendingSends.keys().next().value!);
  });
}

function consumeRecentSend(key: string) {
  const expires = pendingSends.get(key);
  if (expires === undefined) return false;
  pendingSends.delete(key);
  return expires > Date.now();
}

/** Attach to the message, leaving the scroll/virtualizer's layout untouched. */
export function messageSendMotion(
  element: HTMLElement,
  key: Accessor<string | undefined>
) {
  let animation: Animation | undefined;
  onCleanup(() => animation?.cancel());
  createEffect(
    on(
      () => {
        const id = key();
        return id && pendingSends.has(id) ? id : undefined;
      },
      (id) => {
        if (!id || !consumeRecentSend(id)) return;
        if (
          window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
          typeof element.animate !== 'function'
        )
          return;

        animation?.cancel();
        animation = element.animate(
          [
            { opacity: 0, transform: 'translateY(10px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 300,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }
        );
      }
    )
  );
}
