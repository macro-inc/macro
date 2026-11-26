import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import type { Accessor } from 'solid-js';
import type { BlockName } from '../block';

/**
 * Records that the signed-in user opened an item: the history upsert, which
 * orders Recents and Quick Access, and the item's local viewedAt.
 */
export function trackOpen(
  itemId: string,
  blockName: BlockName,
  authenticated: Accessor<boolean | undefined>
): void {
  fireAndForget(record(itemId, blockName, authenticated), 'track-open');
}

async function record(
  itemId: string,
  blockName: BlockName,
  authenticated: Accessor<boolean | undefined>
): Promise<void> {
  try {
    const { track } = await import('./trackBlockOpened');
    if (authenticated() !== true) return;
    // No Solid owner is current after the await, so the tracker must not
    // create computations (a mutation hook): nothing would dispose them.
    track({ itemId, blockName });
  } catch (error) {
    Telemetry.error(error, { surface: 'track-block-opened', blockName });
  }
}
