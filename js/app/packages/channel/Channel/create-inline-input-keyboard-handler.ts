import {
  createEffect,
  on,
  onCleanup,
  type Accessor,
  type Setter,
} from 'solid-js';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  virtualKeyboardHeight,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { scrollElementAboveKeyboard } from '../scroll-utils';
import { isPlatform } from '@core/util/platform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

const INPUT_CONTAINER_SELECTOR = '[data-inline-input-container-id]';

export function createInlineInputKeyboardHandler(
  containerEl: Accessor<HTMLElement | undefined>,
  setIsChannelInputHidden: Setter<boolean>
) {
  let activeInputContainer: HTMLElement | undefined;

  const reset = () => {
    setIsChannelInputHidden(false);
    activeInputContainer = undefined;
  };

  const keyboardWillShowHandler = (event: Event) => {
    const height =
      (event as CustomEvent<{ height: number }>).detail?.height ?? 0;
    if (activeInputContainer) {
      scrollElementAboveKeyboard(activeInputContainer, height);
    }
  };

  const handleFocusIn = (e: FocusEvent) => {
    const inputContainer = (e.target as HTMLElement).closest<HTMLElement>(
      INPUT_CONTAINER_SELECTOR
    );
    if (!inputContainer) return;
    activeInputContainer = inputContainer;

    // HACK: on mobile safari, we need to ensure that the input container is scrolled into view BEFORE we hide the input, and then perform the subsequent scroll. Some sort of weird Safari focus behavior going on.
    if (!isPlatform('ios')) {
      activeInputContainer.scrollIntoView({ block: 'end' });
    }

    setIsChannelInputHidden(true);

    if (isPlatform('ios')) {
      const currentKeyboardHeight = virtualKeyboardHeight();

      if (currentKeyboardHeight > 0) {
        scrollElementAboveKeyboard(activeInputContainer, currentKeyboardHeight);
      } else {
        window.addEventListener('keyboardWillShow', keyboardWillShowHandler, {
          once: true,
        });
      }
    } else {
      // HACK: on mobile safari need to jettison this scroll out past the layout changes caused by the virtual keyboard appearing
      setTimeout(() => {
        if (!activeInputContainer) return;
        activeInputContainer.scrollIntoView({ block: 'end' });
      }, 500);
    }
  };

  const handleFocusOut = (e: FocusEvent) => {
    if (!activeInputContainer) return;
    const nextInputContainer = (e.relatedTarget as HTMLElement | null)?.closest(
      INPUT_CONTAINER_SELECTOR
    );
    if (!nextInputContainer) {
      reset();
    }
  };

  // Attach focus in handler
  createEffect(
    on(containerEl, () => {
      if (!isTouchDevice()) return;
      const el = containerEl();
      if (!el) return;
      el.addEventListener('focusin', handleFocusIn);
      el.addEventListener('focusout', handleFocusOut);

      onCleanup(() => {
        el.removeEventListener('focusin', handleFocusIn);
        el.removeEventListener('focusout', handleFocusOut);
      });
    })
  );

  createEffect(
    on(virtualKeyboardVisible, () => {
      if (!isTouchDevice()) return;
      if (!virtualKeyboardVisible()) {
        if (activeInputContainer) {
          reset();
        }
        return;
      }
      // Mobile web only: scroll active input into view when keyboard appears.
      if (isNativeMobilePlatform()) return;
      setTimeout(() => {
        if (!activeInputContainer) return;
        activeInputContainer.scrollIntoView({
          block: 'center',
          behavior: 'smooth',
        });
      }, 0);
    }),
    { defer: true }
  );
}
