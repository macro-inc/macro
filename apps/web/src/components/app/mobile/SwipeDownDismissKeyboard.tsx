import {
  virtualKeyboardHeight,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { isPlatform } from '@core/util/platform';
import { onCleanup, onMount } from 'solid-js';

const SWIPE_DOWN_THRESHOLD = 5; // px of downward movement to register as a swipe down
const ZONE_HEIGHT = 20; // px above keyboard that activates blur

// The activation zone overlaps an input's action buttons when the input is
// docked to the keyboard, and taps commonly drift past the swipe threshold —
// treat gestures starting on interactive elements as taps, not dismissal
// swipes.
const INTERACTIVE_SELECTOR = 'button, [role="button"], a[href], select';

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
  );
}

function hasTextSelection(active: Element | null): boolean {
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    const { selectionStart, selectionEnd } = active;
    if (
      selectionStart != null &&
      selectionEnd != null &&
      selectionStart !== selectionEnd
    ) {
      return true;
    }
  }
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString() !== '';
}

export function SwipeDownDismissKeyboard() {
  if (!isPlatform('ios')) return;

  let startY = 0;
  let startedOnInteractive = false;

  function handleTouchStart(e: TouchEvent) {
    if (!virtualKeyboardVisible()) return;
    const touch = e.touches[0];
    if (!touch) return;
    startY = touch.clientY;
    startedOnInteractive = isInteractiveTarget(e.target);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!virtualKeyboardVisible()) return;
    if (startedOnInteractive) return;
    const touch = e.touches[0];
    if (!touch) return;
    const keyboardTop = window.innerHeight - virtualKeyboardHeight();
    const inZone =
      touch.clientY >= keyboardTop - ZONE_HEIGHT &&
      touch.clientY <= keyboardTop;
    const swipingDown = touch.clientY - startY > SWIPE_DOWN_THRESHOLD;
    if (inZone && swipingDown) {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      // Preserve text selection — dismissing the keyboard would collapse it and
      // close any selection-anchored toolbars before the user can act on them.
      if (hasTextSelection(active)) return;
      // If the active element is inside a dialog, focus the dialog root instead of
      // blurring — Kobalte's focus trap would immediately re-focus the input after blur().
      // Focusing a non-input element that's still inside the trap satisfies the trap
      // while dismissing the iOS keyboard.
      const dialog = active.closest('[role="dialog"]') as HTMLElement | null;
      if (dialog) {
        if (!dialog.hasAttribute('tabindex'))
          dialog.setAttribute('tabindex', '-1');
        dialog.focus();
      } else {
        active.blur();
      }
    }
  }

  onMount(() => {
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchstart', handleTouchStart);

    onCleanup(() => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
    });
  });

  return null;
}
