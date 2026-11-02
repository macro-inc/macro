import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { useFavoriteDisplayName } from '@app/util/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { onCleanup, onMount, Show } from 'solid-js';
import { ChannelFavoriteRow as FavoriteRow } from '../ChannelFavoriteRows';
import { rowKeyForFavorite } from '../ChannelsRailContext';
import type { useFavoriteReorder } from './useFavoriteReorder';

type FavoriteRowProps = {
  favorite: Favorite;
  reorder: ReturnType<typeof useFavoriteReorder>;
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
  const [, actions] = useDragDropContext() ?? [];
  let didDrag = false;

  actions?.onDragStart(({ draggable: source }) => {
    if (
      source.data.dndScope === props.reorder.scope &&
      source.data.favoriteKey === key
    ) {
      didDrag = true;
    }
  });

  let root: HTMLDivElement | undefined;
  const preventOpenAfterDrag = (event: MouseEvent) => {
    if (!didDrag || event.detail === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  onMount(() => root?.addEventListener('click', preventOpenAfterDrag, true));
  onCleanup(() =>
    root?.removeEventListener('click', preventOpenAfterDrag, true)
  );

  const dropEdge = () => props.reorder.dropEdge(key);

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
      class="relative"
      classList={{
        'opacity-50': draggable.isActiveDraggable,
      }}
    >
      <FavoriteRow favorite={props.favorite} />
      <Show when={dropEdge()}>
        {(edge) => (
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent"
            classList={{
              'top-0': edge() === 'top',
              'bottom-0': edge() === 'bottom',
            }}
          >
            <span class="absolute -top-0.5 left-0 size-1.5 rounded-full bg-accent" />
          </div>
        )}
      </Show>
    </div>
  );
}
