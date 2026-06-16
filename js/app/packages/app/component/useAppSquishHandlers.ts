import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { isIOS } from '@solid-primitives/platform';
import { onCleanup, onMount } from 'solid-js';

const ACTIVE_ELEMENT_POLL_INTERVAL_MS = 1000;

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

function createActiveElementPolling(onActiveElementLost: () => void) {
  let activeElementPollIntervalId: number | undefined;

  const stop = () => {
    if (activeElementPollIntervalId === undefined) return;

    window.clearInterval(activeElementPollIntervalId);
    activeElementPollIntervalId = undefined;
  };

  const start = () => {
    if (activeElementPollIntervalId !== undefined) return;

    activeElementPollIntervalId = window.setInterval(() => {
      if (!virtualKeyboardVisible()) {
        stop();
        return;
      }

      if (!isEditableInput(document.activeElement)) {
        onActiveElementLost();
      }
    }, ACTIVE_ELEMENT_POLL_INTERVAL_MS);
  };

  return { start, stop };
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

    let activeElementPolling: ReturnType<typeof createActiveElementPolling>;

    function resetNativeVirtualKeyboardState() {
      activeElementPolling.stop();
      resetVirtualKeyboardState();
    }

    activeElementPolling = createActiveElementPolling(
      resetNativeVirtualKeyboardState
    );

    const handleKeyboardWillShow = (event: VirtualKeyboardEvent) => {
      setVirtualKeyboardVisible(true);
      setVirtualKeyboardHeight(event.detail?.height ?? 0);
      activeElementPolling.start();
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
      resetNativeVirtualKeyboardState();
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !isEditableInput(document.activeElement)
      ) {
        resetNativeVirtualKeyboardState();
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
        activeElementPolling.stop();
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
    let deferredResetTimeoutId: number | undefined;

    const syncViewportHeight = () => {
      const viewportHeight = getViewportHeight();
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--dvh', `${vh}px`);
    };

    const clearDeferredReset = () => {
      if (deferredResetTimeoutId === undefined) return;

      window.clearTimeout(deferredResetTimeoutId);
      deferredResetTimeoutId = undefined;
    };

    let activeElementPolling: ReturnType<typeof createActiveElementPolling>;

    function resetIOSVirtualKeyboardState() {
      clearDeferredReset();
      viewportHeightBeforeFocus = undefined;
      activeElementPolling.stop();
      resetVirtualKeyboardState();
    }

    activeElementPolling = createActiveElementPolling(
      resetIOSVirtualKeyboardState
    );

    const deferIOSVirtualKeyboardReset = () => {
      clearDeferredReset();
      deferredResetTimeoutId = window.setTimeout(() => {
        deferredResetTimeoutId = undefined;
        if (!isEditableInput(document.activeElement)) {
          resetIOSVirtualKeyboardState();
        }
      });
    };

    const handleResize = () => {
      if (virtualKeyboardVisible()) {
        syncViewportHeight();
        activeElementPolling.start();
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
        activeElementPolling.start();
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
        activeElementPolling.stop();
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
