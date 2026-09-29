import { createSignal } from 'solid-js';

const [isTouchDevice, setIsTouchDevice] = createSignal(false);

if (typeof window !== 'undefined') {
  setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

export { isTouchDevice };
