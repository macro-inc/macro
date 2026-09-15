import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Mentions and document-reference chips default to opening in a new split.
 *
 * Touch stays in the current split — mobile has no split concept and
 * navigates in place. A held modifier does not invert this: if the action
 * would open in a new split, it still does when Shift is held.
 *
 * Call-site `e != null` distinguishes a real click/enter from a programmatic
 * open (null event), which stays in the current split.
 */
export function openInNewSplitForMention(
  defaultOpenInNewSplit: boolean
): boolean {
  if (isTouchDevice()) return false;
  return defaultOpenInNewSplit;
}
