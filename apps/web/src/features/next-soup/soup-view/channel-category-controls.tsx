import {
  useChannelCategoryLayoutQuery,
  useReplaceChannelCategoryLayoutMutation,
} from '@queries/channel/categories';
import type { ChannelCategoryIntent } from '@queries/channel/category-layout';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import { createMemo, For, type JSX, Show } from 'solid-js';

function CategoryDropTarget(props: {
  id: string | null;
  name: string;
  count: number;
  onMove: (channelId: string, categoryId: string | null) => void;
  onRename?: () => void;
  onDelete?: () => void;
  index?: number;
  categoryCount?: number;
  onReorder?: (targetIndex: number) => void;
}) {
  const droppable = createDroppable(
    `channel-category:${props.id ?? 'uncategorized'}`,
    {
      dragType: 'channel-category-target',
      categoryId: props.id,
    }
  );
  const draggable = props.id
    ? createDraggable(`channel-category-order:${props.id}`, {
        dragType: 'channel-category-order',
        categoryId: props.id,
      })
    : undefined;
  const reorderTarget = props.id
    ? createDroppable(`channel-category-order-target:${props.id}`, {
        dragType: 'channel-category-order-target',
        targetIndex: props.index,
      })
    : undefined;
  return (
    <div
      ref={(element) => {
        if (props.id) {
          draggable?.ref(element);
          reorderTarget?.ref(element);
        }
      }}
      class={cn(
        'flex items-center',
        reorderTarget?.isActiveDroppable && 'rounded-lg outline outline-accent'
      )}
    >
      <button
        ref={droppable.ref}
        type="button"
        class={cn(
          'min-h-8 rounded-lg border border-edge px-2.5 text-xs text-ink-muted',
          'hover:bg-ink/3 focus-visible:outline focus-visible:outline-accent',
          droppable.isActiveDroppable && 'border-accent bg-accent/8 text-accent'
        )}
        aria-label={`${props.name} category, ${props.count} channels. Drop a channel here.`}
      >
        {props.name} <span class="text-ink-extra-muted">{props.count}</span>
      </button>
      <Show when={props.onDelete}>
        <button
          type="button"
          class="size-6 rounded-full text-xs text-ink-extra-muted hover:bg-ink/5 disabled:opacity-30"
          aria-label={`Move ${props.name} category left`}
          disabled={props.index === 0}
          onClick={() => props.onReorder?.((props.index ?? 0) - 1)}
        >
          ←
        </button>
        <button
          type="button"
          class="-ml-1 size-6 rounded-full text-xs text-ink-extra-muted hover:bg-ink/5 disabled:opacity-30"
          aria-label={`Move ${props.name} category right`}
          disabled={
            props.index === undefined ||
            props.index >= (props.categoryCount ?? 0) - 1
          }
          onClick={() => props.onReorder?.((props.index ?? 0) + 1)}
        >
          →
        </button>
        <button
          type="button"
          class="size-6 rounded-full text-xs text-ink-extra-muted hover:bg-ink/5"
          aria-label={`Rename ${props.name}`}
          onClick={props.onRename}
        >
          ✎
        </button>
        <button
          type="button"
          class="-ml-1 size-6 rounded-full text-xs text-ink-extra-muted hover:bg-ink/5"
          aria-label={`Delete ${props.name}`}
          onClick={props.onDelete}
        >
          ×
        </button>
      </Show>
    </div>
  );
}

function CategoryListSection(props: {
  id: string | null;
  name: string;
  empty: boolean;
}) {
  const droppable = createDroppable(
    `channel-category-list-section:${props.id ?? 'uncategorized'}`,
    { dragType: 'channel-category-target', categoryId: props.id }
  );
  return (
    <section
      ref={droppable.ref}
      aria-label={`${props.name} category${props.empty ? ', 0 channels' : ''}`}
      class={cn(
        'mx-2 min-h-8 rounded-lg px-3 py-2 text-xs font-medium text-ink-muted',
        props.empty && 'min-h-12 border border-dashed border-edge',
        droppable.isActiveDroppable && 'border-accent bg-accent/8'
      )}
    >
      <div>{props.name}</div>
      <Show when={props.empty}>
        <div class="font-normal text-ink-extra-muted">No channels</div>
      </Show>
    </section>
  );
}

/** Persisted category sections due immediately before a rendered channel row. */
export function ChannelCategorySectionsBefore(props: {
  channelId: string;
  previousChannelId?: string;
}) {
  const query = useChannelCategoryLayoutQuery();
  const sections = createMemo(() => {
    const layout = query.data;
    if (!layout) return [];
    const categoryIds = [...layout.categories.map((item) => item.id), null];
    const categoryFor = (channelId?: string) =>
      channelId
        ? (layout.placements.find((item) => item.channel_id === channelId)
            ?.category_id ?? null)
        : undefined;
    const current = categoryFor(props.channelId);
    const previous = categoryFor(props.previousChannelId);
    if (current === undefined) return [];
    if (current === previous) return [];
    const start =
      previous === undefined ? 0 : categoryIds.indexOf(previous) + 1;
    const end = categoryIds.indexOf(current);
    return categoryIds.slice(start, end + 1).map((id) => ({
      id,
      name:
        layout.categories.find((item) => item.id === id)?.name ??
        'Uncategorized',
      empty: !layout.placements.some((item) => item.category_id === id),
    }));
  });

  return (
    <For each={sections()}>
      {(section) => <CategoryListSection {...section} />}
    </For>
  );
}

/** Empty persisted sections after the final rendered channel group. */
export function ChannelCategoryTrailingSections(props: {
  lastChannelId: string;
}) {
  const query = useChannelCategoryLayoutQuery();
  const sections = createMemo(() => {
    const layout = query.data;
    if (!layout) return [];
    const ids = [...layout.categories.map((item) => item.id), null];
    const last =
      layout.placements.find((item) => item.channel_id === props.lastChannelId)
        ?.category_id ?? null;
    return ids.slice(ids.indexOf(last) + 1).flatMap((id) =>
      layout.placements.some((item) => item.category_id === id)
        ? []
        : [
            {
              id,
              name:
                layout.categories.find((item) => item.id === id)?.name ??
                'Uncategorized',
              empty: true,
            },
          ]
    );
  });
  return (
    <For each={sections()}>
      {(section) => <CategoryListSection {...section} />}
    </For>
  );
}

/** Native Channels-view controls and persistent category drop targets. */
export function ChannelCategoryControls() {
  const query = useChannelCategoryLayoutQuery();
  const replace = useReplaceChannelCategoryLayoutMutation();
  const layout = () => query.data;
  const [, actions] = useDragDropContext() ?? [];

  const counts = createMemo(() => {
    const result = new Map<string | null, number>();
    for (const placement of layout()?.placements ?? []) {
      result.set(
        placement.category_id,
        (result.get(placement.category_id) ?? 0) + 1
      );
    }
    return result;
  });

  const save = (intent: ChannelCategoryIntent) => replace.mutate(intent);
  const addCategory = () => {
    const current = layout();
    if (!current) return;
    save({
      type: 'add-category',
      id: crypto.randomUUID(),
      name: 'New category',
    });
  };
  const move = (
    channelId: string,
    categoryId: string | null,
    targetIndex?: number
  ) => {
    const current = layout();
    if (!current) return;
    save({ type: 'move-channel', channelId, categoryId, targetIndex });
  };
  const rename = (categoryId: string, currentName: string) => {
    const current = layout();
    if (!current) return;
    const name = window.prompt('Category name', currentName)?.trim();
    if (!name) return;
    save({ type: 'rename-category', categoryId, name });
  };
  const remove = (categoryId: string) => {
    const current = layout();
    if (!current) return;
    if (
      !window.confirm(
        'Delete this category? Its channels will move to Uncategorized.'
      )
    )
      return;
    save({ type: 'delete-category', categoryId });
  };

  // One listener owns all category drops; targets communicate through metadata.
  actions?.onDragEnd(({ draggable, droppable }) => {
    if (
      draggable.data?.dragType === 'channel-category-order' &&
      droppable?.data?.dragType === 'channel-category-order-target'
    ) {
      save({
        type: 'move-category',
        categoryId: String(draggable.data.categoryId),
        targetIndex: Number(droppable.data.targetIndex),
      });
      return;
    }
    if (draggable.data?.dragType !== 'channel-category' || !droppable) return;
    if (
      droppable.data?.dragType !== 'channel-category-target' &&
      droppable.data?.dragType !== 'channel-category-row-target'
    )
      return;
    move(
      String(draggable.data.channelId ?? draggable.id),
      (droppable.data.categoryId as string | null) ?? null,
      droppable.data.targetIndex as number | undefined
    );
  });

  return (
    <Show when={query.isSuccess}>
      <div class="flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 py-1.5 border-b border-edge">
        <Button variant="ghost" size="sm" onClick={addCategory}>
          Add category
        </Button>
        <For each={layout()?.categories}>
          {(category, index) => (
            <CategoryDropTarget
              id={category.id}
              name={category.name}
              count={counts().get(category.id) ?? 0}
              onMove={move}
              onRename={() => rename(category.id, category.name)}
              onDelete={() => remove(category.id)}
              index={index()}
              categoryCount={layout()?.categories.length}
              onReorder={(targetIndex) =>
                save({
                  type: 'move-category',
                  categoryId: category.id,
                  targetIndex,
                })
              }
            />
          )}
        </For>
        <CategoryDropTarget
          id={null}
          name="Uncategorized"
          count={counts().get(null) ?? 0}
          onMove={move}
        />
      </div>
    </Show>
  );
}

/** Makes the actual primary-list channel row pointer-draggable and keyboard movable. */
export function ChannelCategoryRowDnd(props: {
  channelId: string;
  channelName: string;
  children: JSX.Element;
}) {
  const query = useChannelCategoryLayoutQuery();
  const replace = useReplaceChannelCategoryLayoutMutation();
  const draggable = createDraggable(`channel-category-row:${props.channelId}`, {
    dragType: 'channel-category',
    channelId: props.channelId,
    name: props.channelName,
  });
  const currentPlacement = () =>
    query.data?.placements.find((item) => item.channel_id === props.channelId);
  const categoryId = () => currentPlacement()?.category_id ?? null;
  const indexInCategory = () =>
    (query.data?.placements ?? [])
      .filter((item) => item.category_id === categoryId())
      .findIndex((item) => item.channel_id === props.channelId);
  const droppable = createDroppable(
    `channel-category-row-target:${props.channelId}`,
    {
      dragType: 'channel-category-row-target',
      get categoryId() {
        return categoryId();
      },
      get targetIndex() {
        return indexInCategory();
      },
    }
  );
  const move = (categoryId: string | null) => {
    if (!query.data) return;
    replace.mutate({
      type: 'move-channel',
      channelId: props.channelId,
      categoryId,
    });
  };
  return (
    <div
      ref={(element) => {
        draggable.ref(element);
        droppable.ref(element);
      }}
      class="group/category-row relative"
      data-channel-category-row
    >
      {props.children}
      <div class="absolute right-2 top-1/2 -translate-y-1/2 hidden gap-1 rounded bg-surface p-1 shadow group-focus-within/category-row:flex group-hover/category-row:flex">
        <For each={query.data?.categories ?? []}>
          {(category) => (
            <button
              type="button"
              class="rounded px-1.5 py-1 text-xs hover:bg-ink/5 focus-visible:outline focus-visible:outline-accent"
              aria-label={`Move ${props.channelName} to ${category.name}`}
              onClick={(event) => {
                event.stopPropagation();
                move(category.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  move(category.id);
                }
              }}
            >
              {category.name}
            </button>
          )}
        </For>
        <button
          type="button"
          class="rounded px-1.5 py-1 text-xs hover:bg-ink/5 focus-visible:outline focus-visible:outline-accent"
          aria-label={`Move ${props.channelName} to Uncategorized`}
          onClick={(event) => {
            event.stopPropagation();
            move(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              move(null);
            }
          }}
        >
          Uncategorized
        </button>
        <button
          type="button"
          class="rounded px-1.5 py-1 text-xs hover:bg-ink/5 focus-visible:outline focus-visible:outline-accent"
          aria-label={`Move ${props.channelName} up within ${categoryId() ? 'its category' : 'Uncategorized'}`}
          disabled={indexInCategory() <= 0}
          onClick={(event) => {
            event.stopPropagation();
            if (!query.data) return;
            replace.mutate({
              type: 'move-channel',
              channelId: props.channelId,
              categoryId: categoryId(),
              targetIndex: indexInCategory() - 1,
            });
          }}
        >
          ↑
        </button>
        <button
          type="button"
          class="rounded px-1.5 py-1 text-xs hover:bg-ink/5 focus-visible:outline focus-visible:outline-accent"
          aria-label={`Move ${props.channelName} down within ${categoryId() ? 'its category' : 'Uncategorized'}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!query.data) return;
            replace.mutate({
              type: 'move-channel',
              channelId: props.channelId,
              categoryId: categoryId(),
              targetIndex: indexInCategory() + 1,
            });
          }}
        >
          ↓
        </button>
      </div>
    </div>
  );
}

/** Leaves DM and non-channel rows completely outside category drag behavior. */
export function MaybeChannelCategoryRowDnd(props: {
  enabled: boolean;
  channelId: string;
  channelName: string;
  children: JSX.Element;
}) {
  return (
    <Show when={props.enabled} fallback={props.children}>
      <ChannelCategoryRowDnd
        channelId={props.channelId}
        channelName={props.channelName}
      >
        {props.children}
      </ChannelCategoryRowDnd>
    </Show>
  );
}
