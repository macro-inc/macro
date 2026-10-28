/**
 * The board explorations, in the order the sidebar lists them. Each is a
 * different answer to "what is happening right now?" over the same items.
 *
 * - `v1a` Neighborhoods: conversation cards clustered by where they happen.
 * - `v1b` Bubbles: pinned-conversation faces with their latest message.
 * - `v1c` River: everything on one timeline, a lane per neighborhood.
 * - `v1d` Radar: what needs you closest to the center, sectors by kind.
 * - `v1e` People: who is saying what, across every conversation.
 */
export const BOARD_VARIANTS = ['v1a', 'v1b', 'v1c', 'v1d', 'v1e'] as const;

export type BoardVariant = (typeof BOARD_VARIANTS)[number];

export const DEFAULT_BOARD_VARIANT: BoardVariant = 'v1a';

/** The short code shown beside each variant's name, e.g. `V1A`. */
export function variantCode(variant: BoardVariant): string {
  return variant.toUpperCase();
}
