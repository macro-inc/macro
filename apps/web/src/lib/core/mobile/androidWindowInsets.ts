import { isPlatform } from '@core/util/platform';
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { onCleanup, onMount } from 'solid-js';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
  virtualKeyboardHeight,
} from './virtualKeyboard';

export type AndroidWindowInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  imeVisible: boolean;
  imeHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

/**
 * Native dp to CSS px. Android can publish a new display density before
 * Chromium updates its viewport, so native dp is not always CSS px. Width is
 * the reference because the keyboard only changes height: a keyboard resize
 * must never rescale the safe-area insets.
 */
function cssScale(insets: AndroidWindowInsets, cssViewportWidth: number) {
  return insets.viewportWidth > 0 ? cssViewportWidth / insets.viewportWidth : 1;
}

// Every root custom-property write recalculates style for the whole document.
function setRootPropertyIfChanged(name: string, value: string) {
  const style = document.documentElement.style;
  if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}

export function applyAndroidWindowInsets(
  insets: AndroidWindowInsets,
  cssViewportWidth = window.innerWidth
) {
  const scale = cssScale(insets, cssViewportWidth);
  const keyboardHeight = insets.imeVisible ? insets.imeHeight * scale : 0;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    setRootPropertyIfChanged(
      `--tauri-inset-${side}`,
      `${insets[side] * scale}px`
    );
  }
  // The WebView keeps its full height under the keyboard, as on iOS: the
  // layout root shrinks through --dvh and fixed sheets lift by the keyboard
  // height, so nothing subtracts the keyboard twice.
  setRootPropertyIfChanged(
    '--dvh',
    insets.imeVisible
      ? `${(insets.viewportHeight * scale - keyboardHeight) * 0.01}px`
      : '1dvh'
  );
  setRootPropertyIfChanged('--virtual-keyboard-height', `${keyboardHeight}px`);
  setVirtualKeyboardHeight(keyboardHeight);
  setVirtualKeyboardVisible(insets.imeVisible);
}

export function useAndroidWindowInsets() {
  if (!isPlatform('android')) return;
  onMount(() => {
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    let receivedEvent = false;
    let currentInsets: AndroidWindowInsets | undefined;
    const applyInsets = (insets: AndroidWindowInsets) => {
      const wasVisible = currentInsets?.imeVisible ?? false;
      currentInsets = insets;
      applyAndroidWindowInsets(insets);
      // Same window events the iOS keyboard bridge dispatches, for behaviours
      // such as keeping a channel scrolled to its latest message.
      if (insets.imeVisible !== wasVisible) {
        window.dispatchEvent(
          new CustomEvent(
            insets.imeVisible ? 'keyboardWillShow' : 'keyboardWillHide',
            { detail: { height: virtualKeyboardHeight() } }
          )
        );
      }
    };
    // Re-applies after Chromium catches up with a density change; a keyboard
    // resize leaves the width-based scale alone, so it writes nothing.
    const onResize = () => {
      if (currentInsets) applyAndroidWindowInsets(currentInsets);
    };
    window.addEventListener('resize', onResize);
    const initialize = async () => {
      try {
        const listener = await addPluginListener<AndroidWindowInsets>(
          'android-mobile',
          'insets',
          (insets) => {
            receivedEvent = true;
            if (!disposed) applyInsets(insets);
          }
        );
        if (disposed) {
          await listener.unregister();
          return;
        }
        remove = () => listener.unregister();
        const insets = await invoke<AndroidWindowInsets>(
          'plugin:android-mobile|getInsets'
        );
        if (!disposed && !receivedEvent) applyInsets(insets);
      } catch (error) {
        console.error('Unable to initialize Android window insets', error);
      }
    };
    void initialize();
    onCleanup(() => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      if (remove) void remove();
    });
  });
}
