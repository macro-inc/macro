/** Size of a large rail nav button (`--rail-button-size` at Large). */
const RAIL_ITEM_SIZE = 40;
/** Space between rail buttons (the rail's and the list's `gap-1`). */
export const RAIL_ITEM_GAP = 4;
/** Space before the first rail nav button (the nav's `pt-4`/`pl-4`). */
export const RAIL_NAV_PADDING_START = 16;

/**
 * How many whole nav buttons fit in `available` px along the rail, so the
 * rail never shows a partial button. The rest go to the More menu.
 * `itemSize` is the button size the dock's size setting picked, and
 * `paddingStart` the space the nav keeps before its first button (none when
 * the apps are centered).
 */
export const railNavFitCount = (
  available: number,
  itemSize = RAIL_ITEM_SIZE,
  paddingStart = RAIL_NAV_PADDING_START
): number => {
  const room = available - paddingStart + RAIL_ITEM_GAP;
  return Math.max(0, Math.floor(room / (itemSize + RAIL_ITEM_GAP)));
};

/** Sizes along the rail, in px, of the parts that share it with the nav. */
export type RailLengths = {
  /** The rail's length inside its padding. */
  inner: number;
  /** Create and Search. */
  start: number;
  /** Return to call and the footer actions. */
  end: number;
  /** The More button after the nav. */
  more: number;
};

/**
 * The room the nav has along the rail once Create/Search, More and the footer
 * have theirs.
 *
 * At the start, the three groups sit in a row with a gap between each, More
 * one gap after the nav, and one more gap before the footer (8px in all).
 * Centered, the apps take the middle grid track between two equal tracks,
 * each at least as long as the longer of the start and end groups, with a
 * gap on either side of the middle and one between the nav and More.
 */
export const railNavRoom = (
  lengths: RailLengths,
  centered: boolean
): number => {
  if (centered) {
    const sideTrack = Math.max(lengths.start, lengths.end);
    return lengths.inner - 2 * sideTrack - lengths.more - 3 * RAIL_ITEM_GAP;
  }

  return (
    lengths.inner -
    lengths.start -
    lengths.end -
    lengths.more -
    4 * RAIL_ITEM_GAP
  );
};
