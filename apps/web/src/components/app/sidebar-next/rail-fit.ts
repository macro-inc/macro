/** Height of a rail nav button (`size-10`). */
const RAIL_ITEM_HEIGHT = 40;
/** Space between rail nav buttons (the list's `gap-1`). */
const RAIL_ITEM_GAP = 4;
/** Space above the first rail nav button (the nav's `pt-4`). */
const RAIL_NAV_PADDING_TOP = 16;

/**
 * How many whole nav buttons fit in `available` px of rail height, so the
 * rail never shows a partial button. The rest go to the More menu.
 */
export const railNavFitCount = (available: number): number => {
  const room = available - RAIL_NAV_PADDING_TOP + RAIL_ITEM_GAP;
  return Math.max(0, Math.floor(room / (RAIL_ITEM_HEIGHT + RAIL_ITEM_GAP)));
};
