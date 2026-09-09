import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Macro uses "splits" as its tab-like navigation concept.
 *
 * For @mention pills we want:
 * - default click/enter: open in a new split
 * - holding Option (alt): open in the current split
 *
 * Shift is not a modifier here — chips already prefer a new split, so callers
 * should pass `event.altKey`, not `event.shiftKey`.
 *
 * We also want touch opens to remain in the current split to avoid surprising
 * split creation. The call-site `e != null` heuristic can't detect touch on
 * iOS WKWebView (taps fire real mouse events), so guard on `isTouchDevice()` here —
 * mobile has no split concept and navigates in place / via forward navigation.
 */
export function openInNewSplitForMention(
  altKey: boolean | undefined,
  defaultOpenInNewSplit: boolean
): boolean {
  if (isTouchDevice()) return false;
  return altKey ? false : defaultOpenInNewSplit;
}
