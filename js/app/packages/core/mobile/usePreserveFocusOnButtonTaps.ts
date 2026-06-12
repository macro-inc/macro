import { isMobile } from '@core/mobile/isMobile';
import { onCleanup, onMount } from 'solid-js';

/**
 * Keeps the focused editor inside the given container focused (and the
 * virtual keyboard open) when the user taps buttons within the same
 * container.
 *
 * On iOS, tapping a button blurs a focused contenteditable even when the
 * button cancels `pointerdown` — WebKit ends the editing session while
 * processing the tap itself, after `touchend`. Cancelling `touchend` is what
 * actually prevents the blur, but it also suppresses the synthesized click,
 * so the click is re-dispatched on the button manually.
 *
 * @param getContainer - Accessor that returns the container element whose
 *   buttons should not steal focus from its editor. Pass `() => ref` where
 *   `ref` is the local element ref.
 */
export function usePreserveFocusOnButtonTaps(
  getContainer: () => HTMLElement | null | undefined
) {
  if (!isMobile()) return;

  onMount(() => {
    function handleTouchEnd(e: TouchEvent) {
      // A gesture that turned into a scroll is no longer cancelable.
      if (!e.cancelable) return;

      const container = getContainer();
      if (!container) return;

      // Only intervene while something inside the container (the editor) is
      // focused — otherwise there is no focus to preserve.
      const active = document.activeElement;
      if (!active || !container.contains(active)) return;

      const target = e.target instanceof Element ? e.target : null;
      const button = target?.closest<HTMLElement>('button, [role="button"]');
      if (!button || !container.contains(button)) return;

      e.preventDefault();

      // Mirror native tap semantics: only activate the button when the
      // finger was released over it.
      const touch = e.changedTouches[0];
      if (!touch) return;
      const released = document.elementFromPoint(touch.clientX, touch.clientY);
      if (released && button.contains(released)) button.click();
    }

    window.addEventListener('touchend', handleTouchEnd, { passive: false });

    onCleanup(() => {
      window.removeEventListener('touchend', handleTouchEnd);
    });
  });
}
