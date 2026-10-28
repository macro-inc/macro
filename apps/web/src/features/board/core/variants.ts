import { match } from 'ts-pattern';

/**
 * The board explorations, in the order the sidebar lists them. Each is a
 * different answer to "what is happening right now?" over the same items.
 *
 * Boards you pan and zoom:
 * - `v1a` Neighborhoods: conversation cards clustered by where they happen.
 * - `v1b` Bubbles: pinned-conversation faces with their latest message.
 * - `v1c` River: everything on one timeline, a lane per neighborhood.
 * - `v1d` Radar: what needs you closest to the center, sectors by kind.
 * - `v1e` People: who is saying what, across every conversation.
 *
 * Lists you scroll, newest first, from least to most detail:
 * - `v2a` Headlines: one line per conversation.
 * - `v2b` Digest: the latest message from each, with who said it.
 * - `v2c` Threads: each conversation's recent messages in full.
 */
export const BOARD_VARIANTS = [
  'v1a',
  'v1b',
  'v1c',
  'v1d',
  'v1e',
  'v2a',
  'v2b',
  'v2c',
] as const;

export type BoardVariant = (typeof BOARD_VARIANTS)[number];

export const DEFAULT_BOARD_VARIANT: BoardVariant = 'v1a';

/** Boards lay items out in space; lists stack them in time. */
export type VariantFamily = 'board' | 'list';

export function variantFamily(variant: BoardVariant): VariantFamily {
  return match(variant)
    .returnType<VariantFamily>()
    .with('v1a', 'v1b', 'v1c', 'v1d', 'v1e', () => 'board')
    .with('v2a', 'v2b', 'v2c', () => 'list')
    .exhaustive();
}

/** The short code shown beside each variant's name, e.g. `V1A`. */
export function variantCode(variant: BoardVariant): string {
  return variant.toUpperCase();
}
