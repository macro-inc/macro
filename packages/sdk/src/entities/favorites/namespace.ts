import type {
  Favorite,
  FavoriteEntityRef,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { FavoritableEntity, MacroEntityType } from '../entity';

export type { Favorite, FavoriteEntityRef };

/**
 * Which favorites to list.
 *
 * The two dimensions are independent. Within one, the values are alternatives;
 * between them they are both required, so `entityTypes: ['document']` with
 * `entityIds: [a, b]` matches only documents `a` and `b`. An omitted or empty
 * list constrains nothing, which is why the default lists the whole collection.
 */
export type FavoritesFilter = {
  entityTypes?: MacroEntityType[];
  entityIds?: string[];
};

/** The user's favorites: a manually ordered collection of entity references. */
export class FavoritesNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The user's favorites, in manual order. */
  async list(filter: FavoritesFilter = {}): Promise<Favorite[]> {
    const { favorites } = unwrap(
      await this.client.storage.listFavorites({
        query: {
          entityType: filter.entityTypes,
          entityId: filter.entityIds,
        },
      }),
    );
    return favorites;
  }

  /**
   * Favorite an entity. Returns the favorite record.
   */
  async add(entity: FavoritableEntity<unknown>): Promise<Favorite> {
    return unwrap(
      await this.client.storage.addFavorite({
        body: { entityId: entity.id, entityType: entity.entityType },
      }),
    );
  }

  /** Remove an entity from the user's favorites. */
  async remove(entity: FavoritableEntity<unknown>): Promise<void> {
    unwrap(
      await this.client.storage.removeFavoriteByEntity({
        path: { entity_type: entity.entityType, entity_id: entity.id },
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
