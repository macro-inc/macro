import { createSignal } from 'solid-js';

const coarsePointerQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

const [isCoarsePointer, setIsCoarsePointer] = createSignal(
  coarsePointerQuery?.matches ?? false
);

// Tracks the media query live (rather than caching the first answer) so
// devtools touch emulation toggled after load is picked up reactively.
coarsePointerQuery?.addEventListener('change', (event) =>
  setIsCoarsePointer(event.matches)
);

/**
 * This function returns true if the device is PRIMARILY touch device, E.g. this should return false for touchscreen laptops. However, the user might still be using a keyboard, e.g. if they have a physical keyboard attached to their iPad. In that case, you may want to use isModality('touch') instead.
 */
export function isTouchDevice(): boolean {
  return isCoarsePointer();
}
