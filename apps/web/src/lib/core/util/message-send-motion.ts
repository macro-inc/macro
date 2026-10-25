import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
        // Keep the text at its final size and the virtual row at its final
        // height. Touch sends lift into place, then settle by just one pixel.
        animation = isTouchDevice()
          ? element.animate(
              [
                {
                  opacity: 0,
                  transform: 'translateY(24px)',
                  offset: 0,
                  easing: 'cubic-bezier(0.16, 0.8, 0.3, 1)',
                },
                {
                  opacity: 1,
                  transform: 'translateY(4px)',
                  offset: 0.4,
                  easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
                },
                {
                  opacity: 1,
                  transform: 'translateY(-1px)',
                  offset: 0.75,
                  easing: 'ease-in-out',
                },
                { opacity: 1, transform: 'translateY(0)', offset: 1 },
              ],
              { duration: 360, easing: 'linear' }
            )
          : element.animate(
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
