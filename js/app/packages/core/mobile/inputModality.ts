/**
 * Returns true if the user is currently using touch input modality.
 * This reflects the most recent input type the user has used.
 * - true: user most recently used touch
 * - false: user most recently used keyboard or mouse
 */
export function isTouchModality(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.modality === 'touch';
}

/**
 * Returns true if the user most recently used keyboard input modality.
 */
export function isKeyboardModality(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.modality === 'keyboard';
}

/**
 * Returns true if the user most recently used mouse input modality.
 */
export function isMouseModality(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.modality === 'mouse';
}
