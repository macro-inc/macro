/**
 * Common CSS classes used across property components
 */

// Number formatting
export const NUMBER_DECIMAL_PLACES = 4;

// Focus configuration
export const FOCUS_CONFIG = {
  DEFAULT_DELAY: 100,
  PROPERTY_NAME_DELAY: 200,
  MAX_ATTEMPTS: 10,
  RETRY_DELAY: 50,
} as const;

// Modal dimensions
export const MODAL_DIMENSIONS = {
  DEFAULT_WIDTH: 448,
  DEFAULT_HEIGHT: 384,
  PROPERTY_EDITOR_HEIGHT: 384,
  SELECTOR_TOP_PERCENTAGE: 0.2,
  SELECTOR_MIN_TOP_MARGIN: 16,
  SELECTOR_SMALL_SCREEN_THRESHOLD: 600,
  SELECTOR_SMALL_SCREEN_TOP_PERCENTAGE: 0.1,
} as const;

// Button classes
export const BUTTON_BASE_CLASSES = 'px-3 py-1.5 text-sm border';
export const PRIMARY_BUTTON_CLASSES =
  'bg-accent/90 hover:bg-accent/80 text-ink';
export const SECONDARY_BUTTON_CLASSES =
  'text-ink-muted hover:text-ink border-edge hover:bg-hover';
export const ACCENT_BUTTON_CLASSES =
  'text-accent hover:text-accent/80 border-accent hover:bg-accent/10';

// Checkbox classes
export const CHECKBOX_BASE_CLASSES =
  'w-4 h-4 border flex items-center justify-center';
