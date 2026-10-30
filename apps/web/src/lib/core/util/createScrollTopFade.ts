import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Accessor, createEffect, onCleanup } from 'solid-js';

/** A compact linear top-edge falloff that leaves content clear at rest. */
export function createScrollTopFade(
  scrollRef: Accessor<HTMLElement | undefined>
) {
  createEffect(() => {
    const element = scrollRef();
    if (!element || isTouchDevice()) return;

    const previousMask = element.style.maskImage;
    const update = () => {
      const height = Math.min(32, Math.max(0, element.scrollTop));
      element.style.maskImage =
        height > 0
          ? `linear-gradient(to bottom, transparent, black ${height}px)`
          : previousMask;
    };

    element.addEventListener('scroll', update, { passive: true });
    update();
    onCleanup(() => {
      element.removeEventListener('scroll', update);
      element.style.maskImage = previousMask;
    });
  });
}
