import type { UnusableKnob } from '@service-scheduled-action/generated/schemas';
import type { UnusableItem } from '../core/knobs';

/**
 * The scheduler's entries with an item picked and a step to show it on. Each
 * names its step by id, so a draft that adds, removes or moves steps, or a
 * list fetched before the last save, keeps each entry on its own step. A step
 * saved before steps had ids has none and is left out; an unpicked knob shows
 * as not set on its own.
 */
export function unusableItemsFromWire(
  entries: readonly UnusableKnob[]
): UnusableItem[] {
  return entries.flatMap(({ step, knob, item, reason }) =>
    item && step ? [{ step, knob, item, reason }] : []
  );
}
