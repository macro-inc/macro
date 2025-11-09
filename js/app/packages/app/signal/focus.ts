import { createSignal } from 'solid-js';

export const [activeElement, setActiveElement] = createSignal<Element | null>(
  document.activeElement
);
