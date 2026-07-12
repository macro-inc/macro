import { debounce } from '@solid-primitives/scheduled';
import { createSignal, onCleanup, onMount } from 'solid-js';

let listeners = new Set<(e?: KeyboardEvent) => void>();
let isListening = false;

const startGlobalListener = () => {
  if (isListening) return;
  isListening = true;
  const onKeydown = (e: KeyboardEvent) => {
    listeners.forEach((listener) => listener(e));
  };
  document.addEventListener('keydown', onKeydown, { capture: true });
  return () => {
    document.removeEventListener('keydown', onKeydown, { capture: true });
    isListening = false;
  };
};

/**
 * Hook to generate a readonly signal that will be true for durationMs after a
 * key is pressed. If no key or key array arg is passed, then will be true for
 * all keys pressed. Currently the utility of this is for temporarily suspending
 * mouse-based hover selection when scrolling a list of items with keyboard or
 * list filtering.
 * @param durationMs
 * @param key
 * @returns A readonly boolean signal
 */
export const useKeyPressed = (
  durationMs: number,
  key?: KeyboardEvent['key'] | KeyboardEvent['key'][]
) => {
  const [state, setState] = createSignal(false);
  const debouncedSetState = debounce(setState, durationMs);

  const handler = (e: KeyboardEvent) => {
    if (key) {
      if (Array.isArray(key)) {
        if (!key.includes(e.key)) return;
      } else {
        if (key !== e.key) return;
      }
    }
    debouncedSetState.clear();
    setState(true);
    debouncedSetState(false);
  };

  let cleanup: (() => void) | undefined;

  onMount(() => {
    listeners.add(handler);
    if (listeners.size === 1) {
      cleanup = startGlobalListener();
    }
    onCleanup(() => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        cleanup?.();
        cleanup = undefined;
      }
    });
  });
  return state;
};
