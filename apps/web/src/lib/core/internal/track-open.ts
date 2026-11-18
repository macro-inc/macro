import { Telemetry } from '@macro-inc/observability';
import { useQueryClient } from '@queries/client';
import type { Accessor } from 'solid-js';
import type { BlockName } from '../block';

/**
 * Records that the signed-in user opened an item: their history (which orders
 * Recents and Quick Access) and the item's local viewedAt. Every view that
 * shows an item on its own calls this once per opened item.
 */
export function trackOpen(
  itemId: string,
  blockName: BlockName,
  authenticated: Accessor<boolean | undefined>
): void {
  // The tracker is loaded lazily and runs outside the query context provider,
  // so it takes the client as an accessor.
  import('./trackBlockOpened')
    .then(({ track }) => {
      if (authenticated() !== true) return;
      track({ itemId, blockName, client: useQueryClient });
    })
    .catch((error) =>
      Telemetry.error(error, { surface: 'track-block-opened', blockName })
    );
}
