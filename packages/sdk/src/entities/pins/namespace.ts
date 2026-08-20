import type {
  PinnedItem,
  ReorderPinRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { FavoritableEntity } from '../entity';

export type { PinnedItem, ReorderPinRequest };

/** The user's pins: items pinned to fixed slots in the home view. */
export class PinsNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The user's pinned items, with their pin indices. */
  async list(): Promise<PinnedItem[]> {
    const { data } = unwrap(await this.client.storage.getPinsHandler({}));
    return data?.recent ?? [];
  }

  /** Pin an entity to a slot. `index` is the slot to put it in. */
  async add(
    entity: FavoritableEntity<unknown>,
    opts: { index: number },
  ): Promise<void> {
    unwrap(
      await this.client.storage.addPinHandler({
        path: { pinned_item_id: entity.id },
        body: { pinType: entity.entityType, pinIndex: opts.index },
      }),
    );
  }

  /** Unpin an entity. */
  async remove(entity: FavoritableEntity<unknown>): Promise<void> {
    unwrap(
      await this.client.storage.removePinHandler({
        path: { pinned_item_id: entity.id },
        body: { pinType: entity.entityType },
      }),
    );
  }

  /** Reorder pins: pass each pinned item with its type and new index. */
  async reorder(pins: ReorderPinRequest[]): Promise<void> {
    unwrap(await this.client.storage.reorderPinsHandler({ body: pins }));
  }
}
