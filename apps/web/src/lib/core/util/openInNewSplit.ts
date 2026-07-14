import { isMobile } from '@core/mobile/isMobile';

/**
 * Macro uses "splits" as its tab-like navigation concept.
 *
 * For @mention pills we want:
 * - default click/enter: open in a new split
 * - holding Option (alt): open in the current split
 *
 * We also want touch opens to remain in the current split to avoid surprising
 * split creation. The call-site `e != null` heuristic can't detect touch on
 * iOS WKWebView (taps fire real mouse events), so guard on `isMobile()` here —
 * mobile has no split concept and navigates in place / via forward navigation.
 */
export function openInNewSplitForMention(
  altKey: boolean | undefined,
  defaultOpenInNewSplit: boolean
): boolean {
  if (isMobile()) return false;
  return altKey ? false : defaultOpenInNewSplit;
}
