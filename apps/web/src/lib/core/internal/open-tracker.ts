import { useIsAuthenticated } from '@core/context/user';
import { type Accessor, createEffect, on } from 'solid-js';
import { type BlockName, useIsNestedBlock, useMaybeBlockName } from '../block';
import { trackOpen } from './track-open';

/**
 * Records each open of an item a route-owned detail view shows in the user's
 * history, as BlockLoader does for the blocks it loads (history only, no
 * analytics). `item` is the shown item's id once it has loaded, and undefined
 * while nothing is shown, so an item shown again after another item or after
 * nothing counts as a new open. Inside a block BlockLoader already records the
 * open (or the block is an embed, which is not an open), so this records
 * nothing there. `ownBlock` records it in the item's own block too, when that
 * block's definition leaves the open to its view (`openTrackingEnabled:
 * false`), as a block whose id can name a record merged into another does.
 */
export function createOpenTracker(
  blockName: BlockName,
  item: Accessor<string | undefined>,
  options?: { ownBlock?: boolean }
): void {
  const block = useMaybeBlockName();
  if (block !== undefined) {
    const records =
      options?.ownBlock === true && block === blockName && !useIsNestedBlock();
    if (!records) return;
  }
  const authenticated = useIsAuthenticated();
  createEffect(
    on(item, (id, previous) => {
      if (id !== undefined && id !== previous)
        trackOpen(id, blockName, authenticated);
    })
  );
}
