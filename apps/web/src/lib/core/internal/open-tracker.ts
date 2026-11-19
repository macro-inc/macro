import { useIsAuthenticated } from '@core/context/user';
import { type Accessor, createEffect, on } from 'solid-js';
import { type BlockName, useMaybeBlockId } from '../block';
import { trackOpen } from './track-open';

/**
 * Records each open of an item a route-owned detail view shows in the user's
 * history, as BlockLoader does for the blocks it loads (history only, no
 * analytics). `item` is the shown item's id once it has loaded, and undefined
 * while nothing is shown, so an item shown again after another item or after
 * nothing counts as a new open. Inside a block BlockLoader already records the
 * open (or the block is an embed, which is not an open), so this records
 * nothing there.
 */
export function createOpenTracker(
  blockName: BlockName,
  item: Accessor<string | undefined>
): void {
  if (useMaybeBlockId() !== undefined) return;
  const authenticated = useIsAuthenticated();
  createEffect(
    on(item, (id, previous) => {
      if (id !== undefined && id !== previous)
        trackOpen(id, blockName, authenticated);
    })
  );
}
