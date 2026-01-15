/**
 * Macro uses "splits" as its tab-like navigation concept.
 *
 * For @mention pills we want:
 * - default click/enter: open in a new split
 * - holding Option (alt): open in the current split
 *
 * We also want touch opens (which typically call handlers without a keyboard/mouse
 * event) to remain in the current split to avoid surprising split creation.
 */
export function openInNewSplitForMention(
  altKey: boolean | undefined,
  defaultOpenInNewSplit: boolean
): boolean {
  return altKey ? false : defaultOpenInNewSplit;
}
