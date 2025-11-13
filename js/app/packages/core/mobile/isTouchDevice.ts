const isTouchDevice = (() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false;

  // Check if primary input is coarse (finger/stylus) rather than fine (mouse)
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

  // Check if hover capability is limited (typical of touch-first devices)
  const hasLimitedHover = window.matchMedia('(hover: none)').matches;

  // For touch-first devices, both conditions are typically true
  if (hasCoarsePointer && hasLimitedHover) return true;

  // Additional check for smaller screens that are likely mobile/tablet
  const isSmallScreen = window.matchMedia('(max-width: 1024px)').matches;

  // Fallback for older devices - but only on smaller screens
  if (isSmallScreen) {
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      // @ts-ignore - for older IE/Edge
      navigator.msMaxTouchPoints > 0
    );
  }

  return false;
})();

export { isTouchDevice };
