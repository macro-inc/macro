import { createEffect, onCleanup } from 'solid-js';
import { FOCUS_CONFIG } from '../constants';

/**
 * Consolidated hook for auto-focusing elements with reliable focus handling.
 * Uses IntersectionObserver to detect when element becomes visible, then focuses after delay.
 */
export function useAutoFocus(
  inputRef: () => HTMLElement | undefined,
  shouldFocus: () => boolean = () => true,
  delay: number = FOCUS_CONFIG.DELAY
) {
  createEffect(() => {
    if (!shouldFocus()) return;

    const element = inputRef();
    if (!element) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // IntersectionObserver fires when element becomes visible (or immediately if already visible)
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;

        // Element is visible, disconnect and focus after delay
        intersectionObserver.disconnect();
        timeoutId = setTimeout(() => {
          const currentElement = inputRef();
          if (
            currentElement &&
            !('disabled' in currentElement && currentElement.disabled) &&
            currentElement.tabIndex >= 0
          ) {
            try {
              currentElement.focus();
            } catch (_error) {
              // Focus failed silently
            }
          }
        }, delay);
      },
      {
        threshold: 0.01,
      }
    );

    intersectionObserver.observe(element);

    onCleanup(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      intersectionObserver.disconnect();
    });
  });

  return { focusElement: () => inputRef()?.focus() };
}

export function useSearchInputFocus(
  inputRef: () => HTMLInputElement | undefined,
  shouldFocus: () => boolean = () => true
) {
  return useAutoFocus(inputRef, shouldFocus);
}

export function usePropertyNameFocus(
  inputRef: () => HTMLInputElement | undefined,
  isCreating: () => boolean
) {
  return useAutoFocus(inputRef, isCreating);
}
