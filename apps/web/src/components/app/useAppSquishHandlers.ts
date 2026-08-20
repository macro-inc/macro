import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
  type VirtualKeyboardEvent,
  virtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { isIOS } from '@solid-primitives/platform';
import { onCleanup, onMount } from 'solid-js';

const ACTIVE_ELEMENT_POLL_INTERVAL_MS = 1000;

/** Approximation of UIKit's private keyboard animation curve. */
const IOS_KEYBOARD_EASING = 'cubic-bezier(0.38, 0.7, 0.125, 1)';

/**
 * Register the squish properties as typed lengths so CSS transitions can
 * interpolate them — unregistered custom properties are not interpolable.
 * Native-app only: a registered property's initial value permanently replaces
 * the `var(--dvh, 1dvh)` fallbacks that the plain web build relies on, and
 * only the native branch sets the properties inline before first paint.
 * Returns whether the properties are animatable.
 */
function registerSquishAnimationProperties(): boolean {
  if (
    typeof CSS === 'undefined' ||
    typeof CSS.registerProperty !== 'function'
  ) {
    return false;
  }
  for (const name of ['--dvh', '--virtual-keyboard-height']) {
    try {
      CSS.registerProperty({
        name,
        syntax: '<length>',
        inherits: true,
        initialValue: '0px',
      });
    } catch {
      // Already registered (HMR re-run) — still animatable.
    }
  }
  return true;
}

function getViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function resetVirtualKeyboardState() {
  document.documentElement.style.setProperty('--dvh', '1dvh');
  document.documentElement.style.setProperty(
    '--virtual-keyboard-height',
    '0px'
  );
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
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
    const animatable = registerSquishAnimationProperties();

    /**
     * Transition the squish properties over the keyboard's own animation
     * duration so the layout tracks the keyboard sliding in/out. A duration
     * of 0 clears the transition so the next property change applies
     * instantly (non-keyboard resets must not replay the last animation).
     */
    const setSquishTransition = (durationSeconds: number) => {
      const style = document.documentElement.style;
      const durationMs = animatable ? Math.round(durationSeconds * 1000) : 0;
      if (durationMs <= 0) {
        style.removeProperty('transition');
        return;
      }
      style.setProperty(
        'transition',
        `--dvh ${durationMs}ms ${IOS_KEYBOARD_EASING}, --virtual-keyboard-height ${durationMs}ms ${IOS_KEYBOARD_EASING}`
      );
    };

    let activeElementPolling: ReturnType<typeof createActiveElementPolling>;

    function resetNativeVirtualKeyboardState() {
      setSquishTransition(0);
      activeElementPolling.stop();
      resetVirtualKeyboardState();
    }

    activeElementPolling = createActiveElementPolling(
      resetNativeVirtualKeyboardState
    );

    const handleKeyboardWillShow = (event: VirtualKeyboardEvent) => {
      activeElementPolling.start();
      const keyboardHeight = event.detail?.height ?? 0;
      const newViewportHeight =
        (window.visualViewport?.height ?? 0) - keyboardHeight;
      const dvh = newViewportHeight * 0.01;
      setSquishTransition(event.detail?.duration ?? 0);
      document.documentElement.style.setProperty('--dvh', `${dvh}px`);
      document.documentElement.style.setProperty(
        '--virtual-keyboard-height',
        `${keyboardHeight}px`
      );
      setVirtualKeyboardVisible(true);
      setVirtualKeyboardHeight(keyboardHeight);
    };

    const handleKeyboardWillHide = (event: VirtualKeyboardEvent) => {
      setSquishTransition(event.detail?.duration ?? 0);
      activeElementPolling.stop();
      resetVirtualKeyboardState();
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
        document.documentElement.style.removeProperty('transition');
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
        activeElementPolling.start();
        syncViewportHeight();
        setTimeout(() => {
          window.scrollTo(0, 0);
        });
        setVirtualKeyboardVisible(true);
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
