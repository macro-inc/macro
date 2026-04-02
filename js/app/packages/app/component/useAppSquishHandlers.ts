import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { isIOS } from '@solid-primitives/platform';
import { onCleanup, onMount } from 'solid-js';

/**
 * Functionality for responding to virtual keyboard appearance in web app and native mobile app.
 */
export function useAppSquishHandlers() {
  if (isNativeMobilePlatform()) {
    type VirtualKeyboardEvent = CustomEventInit<{
      height: number;
      duration: number;
    }>;

    const handleKeyboardWillShow = (event: VirtualKeyboardEvent) => {
      setVirtualKeyboardVisible(true);
      setVirtualKeyboardHeight(event.detail?.height ?? 0);
      const newViewportHeight =
        (window.visualViewport?.height ?? 0) - (event.detail?.height ?? 0);
      const dvh = newViewportHeight * 0.01;
      document.documentElement.style.setProperty('--dvh', `${dvh}px`);
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        `${event.detail?.height ?? 0}px`
      );
    };

    const handleKeyboardWillHide = () => {
      setVirtualKeyboardVisible(false);
      setVirtualKeyboardHeight(0);
      document.documentElement.style.setProperty('--dvh', '1dvh');
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        '0px'
      );
    };

    onMount(() => {
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        '0px'
      );
      document.documentElement.style.setProperty('--dvh', '1dvh');
      window.addEventListener('keyboardWillShow', handleKeyboardWillShow);
      window.addEventListener('keyboardWillHide', handleKeyboardWillHide);

      onCleanup(() => {
        window.removeEventListener('keyboardWillShow', handleKeyboardWillShow);
        window.removeEventListener('keyboardWillHide', handleKeyboardWillHide);
      });
    });
  } else if (isIOS) {
    // We are tracking viewport height, and using that to set a CSS variable,
    // so that we can properly constrain the viewport-height for mobile in response to changes such as
    // the virtual keyboard appearing.
    let previousViewportHeight = window.visualViewport?.height || 0;
    const handleResize = () => {
      if (window.visualViewport) {
        const newViewportHeight = window.visualViewport.height;
        if (newViewportHeight < previousViewportHeight) {
          setVirtualKeyboardVisible(true);
          const vh = newViewportHeight * 0.01;
          document.documentElement.style.setProperty('--dvh', `${vh}px`);
          setTimeout(() => {
            window.scrollTo(0, 0);
          });
        } else {
          setVirtualKeyboardVisible(false);
          document.documentElement.style.setProperty('--dvh', '1dvh');
        }
        previousViewportHeight = newViewportHeight;
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (
        e.target instanceof Element &&
        isEditableInput(e.target) &&
        (!e.relatedTarget ||
          (e.relatedTarget instanceof Element &&
            !isEditableInput(e.relatedTarget)))
      ) {
        document.documentElement.style.setProperty('--dvh', '1dvh');
        setVirtualKeyboardVisible(false);
      }
    };

    onMount(() => {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        handleResize();
        window.visualViewport.addEventListener('scroll', handleResize);
      }
      document.addEventListener('focusout', handleFocusOut);

      onCleanup(() => {
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleResize);
          window.visualViewport.removeEventListener('scroll', handleResize);
        }
        document.removeEventListener('focusout', handleFocusOut);
      });
    });
  }
}
