import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import {
  createScrollIntentTracker,
  SCROLL_INTENT_EVENT,
} from './scroll-intent';

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

/** Keep restored content clear; fade the edge after deliberate desktop scrolling. */
export function createScrollTopFade(
  scrollRef: Accessor<HTMLElement | undefined>
) {
  createEffect(() => {
    const element = scrollRef();
    if (!element || isTouchDevice()) return;

    const previousMask = element.style.maskImage;
    const controller = new AbortController();
    const { signal } = controller;
    const intent = createScrollIntentTracker();
    // Shared scrollbars report intent directly. Native scrollbar input stays
    // on the scroller; ancestor grids can own keyboard navigation.
    const inputRoot = element.parentElement ?? element;
    const document = element.ownerDocument;
    let pointerDown = false;
    let activated = false;
    let previousTop = element.scrollTop;

    const markIntent = () => {
      if (!intent.isUserInteracting()) previousTop = element.scrollTop;
      intent.markUserIntent('down');
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0 && !event.ctrlKey) markIntent();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!inputRoot.contains(target) && !target.contains(element)) return;
      if (
        target.closest(
          'input, textarea, select, button, [role="button"], [role="combobox"], [role="slider"], [role="listbox"], [role="menu"], [contenteditable]:not([contenteditable="false"])'
        )
      ) {
        return;
      }
      markIntent();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target !== element) return;
      const rect = element.getBoundingClientRect();
      const contentLeft = rect.left + element.clientLeft;
      const contentRight = contentLeft + element.clientWidth;
      const inLeftGutter =
        event.clientX >= rect.left && event.clientX < contentLeft;
      const inRightGutter =
        event.clientX >= contentRight && event.clientX < rect.right;
      const inGutter = inLeftGutter || inRightGutter;
      if (!inGutter) return;
      markIntent();
      pointerDown = true;
    };
    const onPointerMove = () => {
      if (pointerDown) markIntent();
    };
    const endPointer = () => {
      pointerDown = false;
    };
    const update = () => {
      if (element.scrollTop !== previousTop && intent.isUserInteracting()) {
        activated = true;
      }
      previousTop = element.scrollTop;
      const height = activated
        ? Math.min(32, Math.max(0, element.scrollTop))
        : 0;
      element.style.maskImage =
        height > 0
          ? `linear-gradient(to bottom, transparent, black ${height}px)`
          : previousMask;
    };
    inputRoot.addEventListener('wheel', onWheel, { passive: true, signal });
    element.addEventListener(SCROLL_INTENT_EVENT, markIntent, { signal });
    element.addEventListener('pointerdown', onPointerDown, {
      capture: true,
      signal,
    });
    document.addEventListener('keydown', onKeyDown, { capture: true, signal });
    document.addEventListener('pointermove', onPointerMove, {
      capture: true,
      signal,
    });
    document.addEventListener('pointerup', endPointer, {
      capture: true,
      signal,
    });
    document.addEventListener('pointercancel', endPointer, {
      capture: true,
      signal,
    });
    document.defaultView?.addEventListener('blur', endPointer, { signal });
    element.addEventListener('scroll', update, { passive: true, signal });
    onCleanup(() => {
      controller.abort();
      element.style.maskImage = previousMask;
    });
  });
}
