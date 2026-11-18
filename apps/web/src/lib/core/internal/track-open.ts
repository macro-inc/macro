import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { useQueryClient } from '@queries/client';
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
    // The tracker runs outside the query context provider, so it takes the
    // client as an accessor.
    track({ itemId, blockName, client: useQueryClient });
  } catch (error) {
    Telemetry.error(error, { surface: 'track-block-opened', blockName });
  }
}
