import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { onCleanup, onMount } from 'solid-js';

/**
 * Dismisses the virtual keyboard when the user touches outside of the given
 * container element. Only activates on mobile when the keyboard is visible
 * and the currently-focused element lives inside the container.
 *
 * @param getContainer - Accessor that returns the container element to treat
 *   as the "inside" boundary. Pass `() => ref` where `ref` is the local
 *   element ref.
 */
export function useTouchOutsideToDismissKeyboard(
  getContainer: () => HTMLElement | null | undefined
) {
  if (!isMobile()) return;

  onMount(() => {
    function handleTouchStart(e: TouchEvent) {
      if (!virtualKeyboardVisible()) return;

      const container = getContainer();
      if (!container) return;

      // Only act when the focused element is inside this container, so that
      // multiple containers on the same page don't interfere with each other.
      const active = document.activeElement as HTMLElement | null;
      if (!active || !container.contains(active)) return;

      const touch = e.touches[0];
      if (!touch) return;

      const target = e.target instanceof Element ? e.target : null;
      // Touch is inside the container — leave the keyboard alone.
      if (!target || container.contains(target)) return;

      // Sibling regions that opt into the keyboard-safe zone (e.g. the input
      // flag, rendered outside the input) must not dismiss the keyboard either.
      if (target.closest('[data-keep-keyboard]')) return;

      // If the active element sits inside a Kobalte dialog, focusing the
      // dialog root instead of calling blur() satisfies the focus-trap while
      // still dismissing the keyboard.
      const dialog = active.closest('[role="dialog"]') as HTMLElement | null;
      if (dialog) {
        if (!dialog.hasAttribute('tabindex')) {
          dialog.setAttribute('tabindex', '-1');
        }
        dialog.focus();
      } else {
        active.blur();
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });

    onCleanup(() => {
      window.removeEventListener('touchstart', handleTouchStart);
    });
  });
}
