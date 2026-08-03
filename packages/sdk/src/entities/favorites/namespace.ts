import type {
  Favorite,
  FavoriteEntityRef,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { MacroEntityType } from '../entity';

export type { Favorite, FavoriteEntityRef };

/** The user's favorites: a manually ordered collection of entity references. */
export class FavoritesNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The user's favorites, in manual order. */
  async list(): Promise<Favorite[]> {
    const { favorites } = unwrap(await this.client.storage.listFavorites({}));
    return favorites;
  }

  /** Favorite an entity by type and id. Returns the favorite record. */
  async add(entityType: MacroEntityType, entityId: string): Promise<Favorite> {
    return unwrap(
      await this.client.storage.addFavorite({
        body: { entityId, entityType },
      }),
    );
  }

  /** Remove a favorite by entity type and id. */
  async remove(entityType: MacroEntityType, entityId: string): Promise<void> {
    unwrap(
      await this.client.storage.removeFavoriteByEntity({
        path: { entity_type: entityType, entity_id: entityId },
      }),
    );
  }

  /** Reorder the favorites: pass every favorited entity in the desired order. */
  async reorder(favorites: FavoriteEntityRef[]): Promise<void> {
    unwrap(
      await this.client.storage.reorderFavorites({
        body: { favorites },
      }),
    );
  }
}
