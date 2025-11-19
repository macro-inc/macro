import { createEffect, onCleanup } from 'solid-js';
import { FOCUS_CONFIG } from '../constants';

/**
 * Consolidated hook for auto-focusing elements with reliable focus handling.
 * Handles race conditions with API responses, modal loading, and DOM updates.
 */
export function useAutoFocus(
  inputRef: () => HTMLElement | undefined,
  shouldFocus: () => boolean = () => true,
  options: {
    delay?: number;
    maxAttempts?: number;
  } = {}
) {
  const {
    delay = FOCUS_CONFIG.DEFAULT_DELAY,
    maxAttempts = FOCUS_CONFIG.MAX_ATTEMPTS,
  } = options;

  const focusElement = (
    element: HTMLElement | undefined,
    attempts = maxAttempts
  ) => {
    if (!element || attempts <= 0) return;

    requestAnimationFrame(() => {
      if (
        element.offsetParent !== null &&
        !('disabled' in element && element.disabled) &&
        element.tabIndex >= 0
      ) {
        try {
          element.focus();
          if (document.activeElement === element) {
            return;
          }
        } catch (_error) {
          // Focus failed, will retry
        }
      }

      setTimeout(() => {
        focusElement(element, attempts - 1);
      }, FOCUS_CONFIG.RETRY_DELAY);
    });
  };

  createEffect(() => {
    if (shouldFocus()) {
      const timeoutId = setTimeout(() => {
        focusElement(inputRef());
      }, delay);

      onCleanup(() => {
        clearTimeout(timeoutId);
      });
    }
  });

  return { focusElement };
}

export function useSearchInputFocus(
  inputRef: () => HTMLInputElement | undefined,
  shouldFocus: () => boolean = () => true
) {
  return useAutoFocus(inputRef, shouldFocus, {
    delay: FOCUS_CONFIG.DEFAULT_DELAY,
  });
}

export function usePropertyNameFocus(
  inputRef: () => HTMLInputElement | undefined,
  isCreating: () => boolean
) {
  return useAutoFocus(inputRef, isCreating, {
    delay: FOCUS_CONFIG.PROPERTY_NAME_DELAY,
  });
}
