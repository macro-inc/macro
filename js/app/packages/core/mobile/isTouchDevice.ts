/**
 * This function returns true if the device is PRIMARILY touch device, E.g. this should return false for touchscreen laptops. However, the user might still be using a keyboard, e.g. if they have a physical keyboard attached to their iPad. In that case, you may want to use isModality('touch') instead.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false;

  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasNoHover = window.matchMedia('(hover: none)').matches;

  return hasCoarsePointer && hasNoHover;
}
