export const NUMBER_DECIMAL_PLACES = 4; // Matches backend precision

export const FOCUS_CONFIG = {
  DEFAULT_DELAY: 100, // Initial render delay
  PROPERTY_NAME_DELAY: 200, // Modal animation delay
  MAX_ATTEMPTS: 10, // Max focus retries
  RETRY_DELAY: 50, // Retry interval
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
