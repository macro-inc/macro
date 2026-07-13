import type { useHotKeyRoot } from '@core/hotkey/hotkeys';
import type {
  HotkeyInterceptorContext,
  KeypressContext,
} from '@core/hotkey/types';
import { createSignal, onCleanup, onMount } from 'solid-js';

export const [hotkeyRoot, setHotkeyRoot] =
  createSignal<ReturnType<typeof useHotKeyRoot>>();

/**
 * Subscribe to keypress events. Automatically cleans up on unmount.
 */
export function useSubscribeToKeypress(
  callback: (context: KeypressContext) => void
) {
  onMount(() => {
    const root = hotkeyRoot();
    if (!root) return;

    const cleanup = root.subscribeToKeypress(callback);
    onCleanup(cleanup);
  });
}

/**
 * Subscribe to hotkey interceptor events BEFORE command lookup.
 * Return true from the callback to capture the event and prevent
 * normal hotkey command lookup and propagation.
 * Automatically cleans up on unmount.
 */
export function useHotkeyInterceptor(
  callback: (context: HotkeyInterceptorContext) => boolean
) {
  onMount(() => {
    const root = hotkeyRoot();
    if (!root) return;

    const cleanup = root.addHotkeyInterceptor(callback);
    onCleanup(cleanup);
  });
}
