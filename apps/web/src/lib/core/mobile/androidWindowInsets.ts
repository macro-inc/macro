import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { onCleanup, onMount } from 'solid-js';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from './virtualKeyboard';

export type AndroidWindowInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  imeVisible: boolean;
  imeHeight: number;
  viewportHeight: number;
};

export function applyAndroidWindowInsets(
  insets: AndroidWindowInsets,
  cssViewportHeight = window.innerHeight
) {
  const style = document.documentElement.style;
  const cssScale =
    insets.viewportHeight > 0 ? cssViewportHeight / insets.viewportHeight : 1;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    style.setProperty(`--tauri-inset-${side}`, `${insets[side] * cssScale}px`);
  }
  // The native inset handler has already removed the IME from the WebView.
  // Its physical height is for keyboard-aware controls, never a second subtraction.
  // Use the WebView's CSS viewport: Android can publish a new display density
  // before Chromium updates its viewport, so native dp is not always CSS px.
  style.setProperty('--dvh', '1dvh');
  // Fixed sheets/dialogs live in that same resized viewport and need no lift.
  style.setProperty('--virtual-keyboard-height', '0px');
  setVirtualKeyboardHeight(insets.imeHeight * cssScale);
  setVirtualKeyboardVisible(insets.imeVisible);
}

export function useAndroidWindowInsets() {
  onMount(() => {
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    let receivedEvent = false;
    let currentInsets: AndroidWindowInsets | undefined;
    const applyInsets = (insets: AndroidWindowInsets) => {
      currentInsets = insets;
      applyAndroidWindowInsets(insets);
    };
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
