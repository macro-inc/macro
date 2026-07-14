/**
 * Returns true if the user's most recent input modality matches the provided value.
 *
 * The modality reflects the most recent input type the user has used.
 */
export function isModality(modality: 'mouse' | 'keyboard' | 'touch'): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.modality === modality;
}
