import type {
  PinnedItem,
  ReorderPinRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { PinnedItem, ReorderPinRequest };

/** The user's pins: items pinned to fixed slots in the home view. */
export class PinsNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The user's pinned items, with their pin indices. */
  async list(): Promise<PinnedItem[]> {
    const { data } = unwrap(await this.client.storage.getPinsHandler({}));
    return data?.recent ?? [];
  }

  /** Pin an item at an index. `pinType` is the item's type (e.g. `document`). */
  async add(
    pinnedItemId: string,
    opts: { pinType: string; pinIndex: number },
  ): Promise<void> {
    unwrap(
      await this.client.storage.addPinHandler({
        path: { pinned_item_id: pinnedItemId },
        body: { pinType: opts.pinType, pinIndex: opts.pinIndex },
      }),
    );
  }

  /** Unpin an item. `pinType` is the item's type (e.g. `document`). */
  async remove(pinnedItemId: string, pinType: string): Promise<void> {
    unwrap(
      await this.client.storage.removePinHandler({
        path: { pinned_item_id: pinnedItemId },
        body: { pinType },
      }),
    );
  }

  /** Reorder pins: pass each pinned item with its type and new index. */
  async reorder(pins: ReorderPinRequest[]): Promise<void> {
    unwrap(await this.client.storage.reorderPinsHandler({ body: pins }));
  }
}
