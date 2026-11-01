import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { useFavoriteDisplayName } from '@app/util/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { type Accessor, onCleanup, onMount, Show } from 'solid-js';
import { ChannelFavoriteRow as FavoriteRow } from '../ChannelFavoriteRows';
import { rowKeyForFavorite } from '../ChannelsRailContext';

type FavoriteRowProps = {
  favorite: Favorite;
  reorder: { scope: string; enabled: Accessor<boolean> };
};

export function ChannelFavoriteRow(props: FavoriteRowProps) {
  return (
    <Show when={rowKeyForFavorite(props.favorite)} keyed>
      {(_key) => <DraggableFavoriteRow {...props} />}
    </Show>
  );
}

function DraggableFavoriteRow(props: FavoriteRowProps) {
  const name = useFavoriteDisplayName(props.favorite);
  const key = rowKeyForFavorite(props.favorite);
  const data = {
    dndScope: props.reorder.scope,
    favoriteKey: key,
    get name() {
      return name();
    },
    overlayIcon: () => (
      <FavoriteIcon favorite={props.favorite} class="size-4" />
    ),
  };
  const draggable = createDraggable(`${props.reorder.scope}:drag:${key}`, data);
  const droppable = createDroppable(`${props.reorder.scope}:drop:${key}`, {
    ...data,
    isDropTargetDisabled: () => !props.reorder.enabled(),
  });
  const [state, actions] = useDragDropContext() ?? [];
  let didDrag = false;
  actions?.onDragStart(({ draggable: source }) => {
    if (
      source.data.dndScope === props.reorder.scope &&
      source.data.favoriteKey === key
    )
      didDrag = true;
  });
  let root: HTMLDivElement | undefined;
  const preventOpenAfterDrag = (event: MouseEvent) => {
    if (!didDrag) return;
    event.preventDefault();
    event.stopPropagation();
  };
  onMount(() => root?.addEventListener('click', preventOpenAfterDrag, true));
  onCleanup(() =>
    root?.removeEventListener('click', preventOpenAfterDrag, true)
  );
  const isTarget = () =>
    props.reorder.enabled() &&
    droppable.isActiveDroppable &&
    state?.active.draggable?.data.favoriteKey !== key;

  return (
    <div
      ref={(element) => {
        root = element;
        draggable.ref(element);
        droppable.ref(element);
      }}
      {...(props.reorder.enabled() ? draggable.dragActivators : {})}
      onPointerDown={() => {
        didDrag = false;
      }}
      classList={{
        'opacity-50': draggable.isActiveDraggable,
        'rounded-lg ring-1 ring-inset ring-accent': isTarget(),
      }}
    >
      <FavoriteRow favorite={props.favorite} />
    </div>
  );
}
