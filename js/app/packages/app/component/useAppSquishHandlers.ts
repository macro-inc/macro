import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { isIOS } from '@solid-primitives/platform';
import { onCleanup, onMount } from 'solid-js';

const IOS_ACTIVE_ELEMENT_POLL_INTERVAL_MS = 1000;

function getViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function resetVirtualKeyboardState() {
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
  document.documentElement.style.setProperty('--dvh', '1dvh');
  document.documentElement.style.setProperty(
    '--virtual-keyboard-height',
    '0px'
  );
}

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
      resetVirtualKeyboardState();
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !isEditableInput(document.activeElement)
      ) {
        resetVirtualKeyboardState();
      }
    };

    onMount(() => {
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        '0px'
      );
      document.documentElement.style.setProperty('--dvh', '1dvh');
      window.addEventListener('keyboardWillShow', handleKeyboardWillShow);
      window.addEventListener('keyboardWillHide', handleKeyboardWillHide);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      onCleanup(() => {
        window.removeEventListener('keyboardWillShow', handleKeyboardWillShow);
        window.removeEventListener('keyboardWillHide', handleKeyboardWillHide);
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      });
    });
  } else if (isIOS) {
    // iOS Safari visual viewport events are only useful after editable focus.
    // A later shrink is the keyboard show signal; focusout remains the reset.
    let viewportHeightBeforeFocus: number | undefined;
    let activeElementPollIntervalId: number | undefined;
    let deferredResetTimeoutId: number | undefined;

    const syncViewportHeight = () => {
      const viewportHeight = getViewportHeight();
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--dvh', `${vh}px`);
    };

    const stopActiveElementPolling = () => {
      if (activeElementPollIntervalId === undefined) return;

      window.clearInterval(activeElementPollIntervalId);
      activeElementPollIntervalId = undefined;
    };

    const clearDeferredReset = () => {
      if (deferredResetTimeoutId === undefined) return;

      window.clearTimeout(deferredResetTimeoutId);
      deferredResetTimeoutId = undefined;
    };

    const resetIOSVirtualKeyboardState = () => {
      clearDeferredReset();
      viewportHeightBeforeFocus = undefined;
      stopActiveElementPolling();
      resetVirtualKeyboardState();
    };

    const deferIOSVirtualKeyboardReset = () => {
      clearDeferredReset();
      deferredResetTimeoutId = window.setTimeout(() => {
        deferredResetTimeoutId = undefined;
        if (!isEditableInput(document.activeElement)) {
          resetIOSVirtualKeyboardState();
        }
      });
    };

    const startActiveElementPolling = () => {
      if (activeElementPollIntervalId !== undefined) return;

      activeElementPollIntervalId = window.setInterval(() => {
        if (!virtualKeyboardVisible()) {
          stopActiveElementPolling();
          return;
        }

        if (!isEditableInput(document.activeElement)) {
          resetIOSVirtualKeyboardState();
        }
      }, IOS_ACTIVE_ELEMENT_POLL_INTERVAL_MS);
    };

    const handleResize = () => {
      if (virtualKeyboardVisible()) {
        syncViewportHeight();
        startActiveElementPolling();
        return;
      }

      if (
        viewportHeightBeforeFocus === undefined ||
        !isEditableInput(document.activeElement)
      ) {
        return;
      }

      const viewportHeight = getViewportHeight();
      if (viewportHeight < viewportHeightBeforeFocus) {
        setVirtualKeyboardVisible(true);
        startActiveElementPolling();
        syncViewportHeight();
        setTimeout(() => {
          window.scrollTo(0, 0);
        });
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !isEditableInput(e.target)) return;

      clearDeferredReset();
      viewportHeightBeforeFocus = getViewportHeight();
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !isEditableInput(e.target)) return;

      if (!e.relatedTarget) {
        deferIOSVirtualKeyboardReset();
        return;
      }

      if (
        e.relatedTarget instanceof Element &&
        !isEditableInput(e.relatedTarget)
      ) {
        resetIOSVirtualKeyboardState();
      }
    };

    onMount(() => {
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        '0px'
      );
      document.documentElement.style.setProperty('--dvh', '1dvh');
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        window.visualViewport.addEventListener('scroll', handleResize);
      }
      document.addEventListener('focusin', handleFocusIn, { capture: true });
      document.addEventListener('focusout', handleFocusOut, { capture: true });

      onCleanup(() => {
        clearDeferredReset();
        stopActiveElementPolling();
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleResize);
          window.visualViewport.removeEventListener('scroll', handleResize);
        }
        document.removeEventListener('focusin', handleFocusIn, {
          capture: true,
        });
        document.removeEventListener('focusout', handleFocusOut, {
          capture: true,
        });
      });
    });
  }
}
