import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import {
  favoriteEntityType,
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
} from '@queries/favorites/favorites';
import type { EntityActionListState } from './entity-action-context';

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

  // Foreign entities (pull requests included) are not offered; favorites
  // already saved for them stay removable from the sidebar.
  const canExecute = (entity: EntityData): boolean =>
    entity.type !== 'foreign' && favoriteEntityType(entity.type) !== undefined;

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
    const queued = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'queued'
    ).length;
    const succeeded = results.length - failed;
    const summary =
      succeeded > 1
        ? t(
            shouldRemove
              ? 'entityActions.toastRemovedCountFromFavorites'
              : 'entityActions.toastAddedCountToFavorites',
            { count: succeeded }
          )
        : t(
            shouldRemove
              ? 'entityActions.toastRemovedFromFavorites'
              : 'entityActions.toastAddedToFavorites'
          );
    if (failed === 0 && queued === 0) {
      toast.success(summary);
    } else if (failed === 0) {
      toast.alert(t('entityActions.toastWaitingToSync', { message: summary }));
    } else if (succeeded === 0) {
      toast.failure(t('entityActions.toastFavoritesUpdateFailed'));
    } else {
      toast.failure(
        t(
          shouldRemove
            ? 'entityActions.toastRemovedSomeFromFavorites'
            : 'entityActions.toastAddedSomeToFavorites',
          { succeeded, count: results.length, failed }
        )
      );
    }
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    // Favoriting doesn't change the list contents; keep selection/focus.
    await execute(entities);
  };

  return { canExecute, isFavorited, execute, executeWithSoup };
};
