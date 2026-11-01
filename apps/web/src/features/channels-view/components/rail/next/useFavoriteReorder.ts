import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  useFavoritesData,
  useReorderFavoritesMutation,
} from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { rowKeyForFavorite, useChannelsRail } from '../ChannelsRailContext';

/** Replace only visible favorite slots, preserving hidden and other-type favorites. */
export function reorderVisibleFavorites(
  all: readonly Favorite[],
  visible: readonly Favorite[],
  sourceKey: string,
  targetKey: string
): Favorite[] | undefined {
  const source = visible.findIndex(
    (item) => rowKeyForFavorite(item) === sourceKey
  );
  const target = visible.findIndex(
    (item) => rowKeyForFavorite(item) === targetKey
  );
  if (source < 0 || target < 0 || source === target) return;
  const keys = new Set(visible.map(rowKeyForFavorite));
  const allKeys = new Set(all.map(rowKeyForFavorite));
  if (visible.some((item) => !allKeys.has(rowKeyForFavorite(item)))) return;
  const reordered = [...visible];
  reordered.splice(target, 0, ...reordered.splice(source, 1));
  let index = 0;
  return all.map((item) =>
    keys.has(rowKeyForFavorite(item)) ? reordered[index++] : item
  );
}

export function useFavoriteReorder(visible: Accessor<readonly Favorite[]>) {
  const rail = useChannelsRail();
  const userId = useUserId();
  const favorites = useFavoritesData();
  const mutation = useReorderFavoritesMutation();
  const [saving, setSaving] = createSignal(false);
  const [, actions] = useDragDropContext() ?? [];
  const scope = `${rail.railId}:favorites`;
  const account = createMemo(() => ({ id: userId() }));
  let dragAccount: ReturnType<typeof account> | undefined;
  const enabled = () =>
    !!userId() &&
    !saving() &&
    rail.sectionPreferences('favorites').sort === 'manual' &&
    favorites() !== undefined &&
    visible().length > 1;

  actions?.onDragStart(({ draggable }) => {
    if (draggable.data.dndScope === scope) dragAccount = account();
  });
  const save = async (items: Favorite[], entityId: string) => {
    const requestAccount = account();
    setSaving(true);
    try {
      await Telemetry.span('channels.favorites.reorder', async (span) => {
        span.setAttr('entity.id', entityId);
        span.setAttr('entity.type', 'channel');
        span.setAttr('favorites.count', items.length);
        await mutation.mutateAsync({
          favorites: items.map(({ entityType, entityId }) => ({
            entityType,
            entityId,
          })),
        });
      });
    } catch {
      if (requestAccount === account())
        toast.failure(t('channelSections.reorderFavoritesFailed'));
    } finally {
      setSaving(false);
    }
  };
  actions?.onDragEnd(({ draggable, droppable }) => {
    if (!enabled() || dragAccount !== account() || !droppable) return;
    if (draggable.data.dndScope !== scope || droppable.data.dndScope !== scope)
      return;
    const sourceKey = draggable.data.favoriteKey;
    const targetKey = droppable.data.favoriteKey;
    if (typeof sourceKey !== 'string' || typeof targetKey !== 'string') return;
    const items = reorderVisibleFavorites(
      favorites()?.favorites ?? [],
      visible(),
      sourceKey,
      targetKey
    );
    const source = visible().find(
      (item) => rowKeyForFavorite(item) === sourceKey
    );
    if (!items || !source) return;
    fireAndForget(save(items, source.entityId), 'channels-view');
  });
  return { scope, enabled };
}
