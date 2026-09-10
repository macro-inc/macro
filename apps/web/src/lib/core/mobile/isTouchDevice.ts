import { createSignal } from 'solid-js';

// This is a media query that checks if use is using a
// pointing device, such as a finger on a touch screen.
const coarsePointerQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

const [touchFirst, setTouchFirst] = createSignal(
  coarsePointerQuery?.matches ?? false
);

// Latch ON only. Transient flips to fine are ignored, because the most
// common cause is DevTools' element picker borrowing the pointer.
coarsePointerQuery?.addEventListener('change', (event) => {
  if (event.matches) setTouchFirst(true);
});

// A real viewport change (device emulation toggled off, rotation, window
// resize) is a legitimate "the world changed" signal: re-read absolutely.
// The picker never resizes the viewport, so it can never land here.
if (coarsePointerQuery) {
  addEventListener('resize', () => {
    setTouchFirst(coarsePointerQuery.matches);
  });
}

/**
 * This function returns true if the device is PRIMARILY touch device, E.g. this should return false for touchscreen laptops. However, the user might still be using a keyboard, e.g. if they have a physical keyboard attached to their iPad. In that case, you may want to use isModality('touch') instead.
 */
export function isTouchDevice(): boolean {
  return touchFirst();
}
