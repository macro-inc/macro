import type { useHotKeyRoot } from '@core/hotkey/hotkeys';
import type { KeypressContext } from '@core/hotkey/types';
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
