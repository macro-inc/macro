import { debounce } from '@solid-primitives/scheduled';
import { createSignal, onCleanup, onMount } from 'solid-js';

const [isKeypressActive, setKeypressActive] = createSignal(false);
const debouncedSetKeypressActive = debounce(
  setKeypressActive,
  // based on initial OS keydown delay
  500
);
const onKeydown = () => {
  setKeypressActive(true);
  debouncedSetKeypressActive(false);
};
const onKeyup = () => {
  debouncedSetKeypressActive.clear();
  setKeypressActive(false);
};
let init = false;

export const useIsKeyPressActive = () => {
  if (!init) {
    init = true;

    onMount(() => {
      document.addEventListener('keydown', onKeydown, { capture: true });
      document.addEventListener('keyup', onKeyup, { capture: true });
    });
    onCleanup(() => {
      document.removeEventListener('keydown', onKeydown, { capture: true });
      document.removeEventListener('keyup', onKeyup, { capture: true });
      init = false;
    });
  }

  return { isKeypressActive };
};
