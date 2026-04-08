import {
  createEffect,
  on,
  onCleanup,
  type Accessor,
  type Setter,
} from 'solid-js';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { scrollElementAboveKeyboard } from '../scroll-utils';

const INPUT_CONTAINER_SELECTOR = '[data-inline-input-container-id]';

export function createInlineInputKeyboardHandler(
  containerEl: Accessor<HTMLElement | undefined>,
  setIsChannelInputHidden: Setter<boolean>
): void {
  let getActiveInputContainer: (() => HTMLElement | undefined) | undefined;

  createEffect(() => {
    if (!isMobile()) return;
    const el = containerEl();
    if (!el) return;
    const result = attachInlineInputKeyboardHandler(
      el,
      setIsChannelInputHidden
    );
    getActiveInputContainer = result.getActiveInputContainer;
    onCleanup(() => {
      result.cleanup();
      getActiveInputContainer = undefined;
    });
  });

  // Mobile web fallback: watch for virtualKeyboardVisible signal, and scroll active input listner into view.
  createEffect(
    on(virtualKeyboardVisible, () => {
      if (!isMobile() || isNativeMobilePlatform()) return;
      if (!virtualKeyboardVisible()) return;
      const container = getActiveInputContainer?.();
      if (container) {
        setTimeout(() => {
          container.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 0);
      }
    }),
    { defer: true }
  );
}

function attachInlineInputKeyboardHandler(
  containerEl: HTMLElement,
  setIsChannelInputHidden: Setter<boolean>
): {
  getActiveInputContainer: () => HTMLElement | undefined;
  cleanup: () => void;
} {
  let keyboardWillShowHandler: ((e: Event) => void) | undefined;
  let activeInputContainer: HTMLElement | undefined;

  const handleFocusIn = (e: FocusEvent) => {
    const inputContainer = (e.target as HTMLElement).closest<HTMLElement>(
      INPUT_CONTAINER_SELECTOR
    );
    if (!inputContainer) return;
    activeInputContainer = inputContainer;

    setIsChannelInputHidden(true);
    const currentKeyboardHeight = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--virtual-keyboard-height'
      )
    );
    if (currentKeyboardHeight > 0) {
      scrollElementAboveKeyboard(activeInputContainer, currentKeyboardHeight);
    } else {
      if (keyboardWillShowHandler)
        window.removeEventListener('keyboardWillShow', keyboardWillShowHandler);
      keyboardWillShowHandler = (event: Event) => {
        const height =
          (event as CustomEvent<{ height: number }>).detail?.height ?? 0;
        if (activeInputContainer)
          scrollElementAboveKeyboard(activeInputContainer, height);
        keyboardWillShowHandler = undefined;
      };
      window.addEventListener('keyboardWillShow', keyboardWillShowHandler, {
        once: true,
      });
    }
  };

  const handleFocusOut = (e: FocusEvent) => {
    const inputContainer = (e.target as HTMLElement).closest<HTMLElement>(
      INPUT_CONTAINER_SELECTOR
    );
    if (!inputContainer) return;
    const nextInputContainer = (e.relatedTarget as HTMLElement | null)?.closest(
      INPUT_CONTAINER_SELECTOR
    );
    if (!nextInputContainer) {
      setIsChannelInputHidden(false);
      activeInputContainer = undefined;
      if (keyboardWillShowHandler) {
        window.removeEventListener('keyboardWillShow', keyboardWillShowHandler);
        keyboardWillShowHandler = undefined;
      }
    }
  };

  containerEl.addEventListener('focusin', handleFocusIn);
  containerEl.addEventListener('focusout', handleFocusOut as EventListener);

  return {
    getActiveInputContainer: () => activeInputContainer,
    cleanup: () => {
      containerEl.removeEventListener('focusin', handleFocusIn);
      containerEl.removeEventListener(
        'focusout',
        handleFocusOut as EventListener
      );
      if (keyboardWillShowHandler) {
        window.removeEventListener('keyboardWillShow', keyboardWillShowHandler);
      }
    },
  };
}
