/**
 * Business logic constants for Properties components
 * For styling constants, see styles/styles.ts (PROPERTY_STYLES)
 */

export const NUMBER_DECIMAL_PLACES = 4; // Matches backend precision

export const FOCUS_CONFIG = {
  DELAY: 100, // Delay before focusing element after it's connected to DOM
} as const;

export const MODAL_DIMENSIONS = {
  DEFAULT_WIDTH: 448, // 28rem
  DEFAULT_HEIGHT: 384, // 24rem
  PROPERTY_EDITOR_HEIGHT: 384,
  SELECTOR_TOP_PERCENTAGE: 0.2, // 20% from top
  SELECTOR_MIN_TOP_MARGIN: 16, // 1rem
  SELECTOR_SMALL_SCREEN_THRESHOLD: 600, // Mobile breakpoint
  SELECTOR_SMALL_SCREEN_TOP_PERCENTAGE: 0.1, // 10% from top
} as const;
