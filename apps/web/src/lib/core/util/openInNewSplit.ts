import { isTouchDevice } from '@core/mobile/isTouchDevice';

/** Click/key modifiers used to decide whether a mention opens in a new split. */
export type MentionOpenModifiers = {
  altKey?: boolean;
  shiftKey?: boolean;
};

/**
 * Macro uses "splits" as its tab-like navigation concept.
 *
 * For @mention / reference chips:
 * - default click/enter: open in a new split
 * - Shift: prefer a new split (chips already do, so this is a no-op)
 * - Option (alt): open in the current split
 *
 * Touch stays in the current split. The call-site `e != null` heuristic
 * can't detect touch on iOS WKWebView (taps fire real mouse events), so
 * guard on `isTouchDevice()` here — mobile has no split concept.
 *
 * Pass the originating mouse/keyboard event, or `null` for a programmatic open.
 */
export function openInNewSplitForMention(
  event: MentionOpenModifiers | null | undefined
): boolean {
  if (isTouchDevice() || event == null) return false;
  if (event.altKey) return false;
  return true;
}
