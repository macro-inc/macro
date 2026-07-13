import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import {
  favoriteEntityType,
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
} from '@queries/favorites/favorites';
import type { SoupState } from '../create-soup-state';

/**
 * Toggle an entity in the user's favorites.
 *
 * `execute` favorites every entity that is not yet favorited; when all of them
 * already are, it unfavorites them instead.
 */
export const makeFavoriteAction = () => {
  // Non-suspending accessor: isFavorited runs inside command-menu
  // description()/condition() callbacks, where a pending or failed favorites
  // query must not suspend or throw.
  const favoritesData = useFavoritesData();
  const addMutation = useAddFavoriteMutation();
  const removeMutation = useRemoveFavoriteMutation();

  const canExecute = (entity: EntityData): boolean =>
    favoriteEntityType(entity.type) !== undefined;

  const isFavorited = (entity: EntityData): boolean => {
    const type = favoriteEntityType(entity.type);
    if (!type) return false;
    const favorites = favoritesData()?.favorites;
    if (!favorites) return false;
    return favorites.some(
      (favorite) =>
        favorite.entityType === type && favorite.entityId === entity.id
    );
  };

  const execute = async (entities: EntityData[]) => {
    const favoritable = entities.filter(canExecute);
    if (favoritable.length === 0) return;
    // Ignore re-triggers while a toggle is still settling so a rapid
    // double-press can't fire an add and its own remove against each other.
    if (addMutation.isPending || removeMutation.isPending) return;

    const shouldRemove = favoritable.every((entity) => isFavorited(entity));
    const verb = shouldRemove ? 'Removed' : 'Added';
    const preposition = shouldRemove ? 'from' : 'to';

    // On add, skip entities already favorited so counts reflect real work.
    const targets = shouldRemove
      ? favoritable
      : favoritable.filter((entity) => !isFavorited(entity));
    if (targets.length === 0) return;

    const results = await Promise.allSettled(
      targets.map((entity) => {
        const entityType = favoriteEntityType(entity.type)!;
        const args = { entityType, entityId: entity.id };
        return shouldRemove
          ? removeMutation.mutateAsync(args)
          : addMutation.mutateAsync(args);
      })
    );

    // Each mutation rolls its own optimistic change back on failure, so report
    // what actually happened rather than an all-or-nothing result.
    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.length - failed;
    if (failed === 0) {
      toast.success(
        succeeded > 1
          ? `${verb} ${succeeded} items ${preposition} favorites`
          : `${verb} ${preposition} favorites`
      );
    } else if (succeeded === 0) {
      toast.failure('Failed to update favorites');
    } else {
      toast.failure(
        `${verb} ${succeeded} of ${results.length} items ${preposition} favorites; ${failed} failed`
      );
    }
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    // Favoriting doesn't change the list contents; keep selection/focus.
    await execute(entities);
  };

  return { canExecute, isFavorited, execute, executeWithSoup };
};
