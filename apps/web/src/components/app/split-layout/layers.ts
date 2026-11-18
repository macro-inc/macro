import type { SplitId } from './layoutManager';

/**
 * The layer the split layout renders before (or without) desktop tabs. The
 * tab manager gives its first live tab this id, so enabling tabs keeps the
 * panes that are already mounted.
 */
export const INITIAL_LAYER_ID = 'initial';

/**
 * Groups of panes rendered side by side in the split layout, one per desktop
 * tab. Only the live layer shows the router's open panes; the others hold
 * parked panes, kept mounted but hidden and inert.
 */
export type SplitLayers = {
  layerIds(): readonly string[];
  layerSplits(layer: string): readonly SplitId[];
  isLive(layer: string): boolean;
};

/** Equality for id lists, so layer memos keep their identity. */
export function sameIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length && left.every((id, i) => id === right[i]);
}
