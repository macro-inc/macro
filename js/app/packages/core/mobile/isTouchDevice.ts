export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false;

  // "Primarily touch" == touch-first input (primary pointer is coarse AND primary hover is none).
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasNoHover = window.matchMedia('(hover: none)').matches;

  return hasCoarsePointer && hasNoHover;
}
