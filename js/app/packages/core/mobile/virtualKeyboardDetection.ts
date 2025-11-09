import { Capacitor } from '@capacitor/core';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const KEYBOARD_HEIGHT_THRESHOLD = 0.15;

export const [keyboardVisible, setKeyboardVisible] = createSignal(false);

function createKeyboardDetection() {
  const [isVirtualKeyboardVisible, setIsVirtualKeyboardVisible] =
    createSignal(false);

  let initialViewportHeight = window.visualViewport
    ? window.visualViewport.height
    : window.innerHeight;

  function setupViewportDetection() {
    const handleResize = (): void => {
      let currentHeight = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;

      const heightDifference = initialViewportHeight - currentHeight;
      const threshold = initialViewportHeight * KEYBOARD_HEIGHT_THRESHOLD;

      if (isMobileWidth()) {
        if (heightDifference > threshold) {
          setIsVirtualKeyboardVisible(true);
          // Testing if height has return to orginal plus or minus a tolerance of 10px
        } else if (Math.abs(currentHeight - initialViewportHeight) < 10) {
          setIsVirtualKeyboardVisible(false);
        }
      } else {
        setIsVirtualKeyboardVisible(false);
      }
    };

    // Reset initial height when orientation changes
    const handleOrientationChange = () => {
      setTimeout(() => {
        initialViewportHeight = window.visualViewport
          ? window.visualViewport.height
          : window.innerHeight;
        setIsVirtualKeyboardVisible(false);
      }, 300);
    };

    initialViewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    // Use visualViewport resize event when available, otherwise fallback to window resize
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    } else {
      window.addEventListener('resize', handleResize);
    }

    window.addEventListener('orientationchange', handleOrientationChange);

    onCleanup(() => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      } else {
        window.removeEventListener('resize', handleResize);
      }
      window.removeEventListener('orientationchange', handleOrientationChange);
    });
  }

  createEffect(() => {
    setupViewportDetection();
  });

  return isVirtualKeyboardVisible;
}

const keyboardDetectionResource = createSingletonRoot(createKeyboardDetection);

export function useIsVirtualKeyboardVisible(): Accessor<boolean | undefined> {
  if (
    (Capacitor.getPlatform() === 'ios' ||
      Capacitor.getPlatform() === 'android') &&
    Capacitor.isPluginAvailable('Keyboard')
  ) {
    return keyboardVisible;
  }

  const isVirtualKeyboardVisible = keyboardDetectionResource();
  return isVirtualKeyboardVisible;
}
