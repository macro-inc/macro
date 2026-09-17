import {
  CollapsibleSection,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import CheckSquareIcon from '@phosphor/check-square.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useTasksView } from '../tasks-view-context';
import type { TaskTab } from '../types';

const TASK_NAV_ITEMS = [
  { id: 'my-tasks', label: 'My Tasks', icon: CheckSquareIcon },
  { id: 'team-tasks', label: 'All Tasks', icon: ListChecksIcon },
  { id: 'created-by-me', label: 'Created by me', icon: NoteIcon },
] satisfies { id: TaskTab; label: string; icon: typeof NoteIcon }[];

export function TasksNavigation(props: { onNavigate?: () => void }) {
  const { state, setTab } = useTasksView();

  return (
    <ViewSidebar.Nav aria-label="Task views">
      <For each={TASK_NAV_ITEMS}>
        {(item) => (
          <ViewSidebar.Item
            active={state.tab === item.id}
            onClick={() => {
              setTab(item.id);
              props.onNavigate?.();
            }}
          >
            <ViewSidebar.Icon>
              <Dynamic component={item.icon} class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">{item.label}</span>
          </ViewSidebar.Item>
        )}
      </For>
    </ViewSidebar.Nav>
  );
}

function FavoriteRow(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite, name: string, event: MouseEvent) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);

  return (
    <FavoriteContextMenu favorite={props.favorite} triggerClass="block">
      <ViewSidebar.Item
        title={name()}
        onClick={(event) => props.onOpen(props.favorite, name(), event)}
      >
        <ViewSidebar.Icon>
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">{name()}</span>
      </ViewSidebar.Item>
    </FavoriteContextMenu>
  );
}

function TaskFavorites(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useFavoritesData();
  const layout = useSplitLayout();
  const { openTask } = useTasksView();
  const favorites = createMemo(() =>
    (data()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'document' &&
          favorite.documentSubType === 'task'
      )
      .sort((left, right) => left.sortOrder - right.sortOrder)
  );
  const openFavorite = (
    favorite: Favorite,
    fallbackName: string,
    event: MouseEvent
  ) => {
    if (event.shiftKey) {
      layout.openWithSplit(favoriteSplitContent(favorite), {
        referredFrom: 'sidebar',
        preferNewSplit: true,
      });

      return;
    }

    openTask({
      id: favorite.entityId,
      fallbackName,
    });
  };

  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Trigger>
        <span class="min-w-0 truncate">Favorites</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <CollapsibleSection.Content>
        <ViewSidebar.Nav aria-label="Favorite tasks">
          <For each={favorites()}>
            {(favorite) => (
              <FavoriteRow favorite={favorite} onOpen={openFavorite} />
            )}
          </For>
          <Show when={favorites().length === 0}>
            <p class="px-3 py-2 text-sm text-ink-extra-muted">
              No favorites yet
            </p>
          </Show>
        </ViewSidebar.Nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

export function TasksSidebar() {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const {
    state,
    setTab,
    setFacets,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useTasksView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => TASK_NAV_ITEMS.map((tab) => tab.id),
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  return (
    <ViewSidebar.Root aria-label="Tasks navigation">
      <SidebarCreateHeader
        title="Tasks"
        label="New task"
        onCreate={() =>
          layout.popoverSplit({ type: 'component', id: 'task-compose' })
        }
      />

      <ViewSidebar.Content>
        <TasksNavigation />

        <TaskFavorites
          open={isSidebarSectionOpen('favorites')}
          onOpenChange={(open) => setSidebarSectionOpen('favorites', open)}
        />

        {/* Tags narrow the current tab; switching tabs clears them like any facet. */}
        <SidebarTagsSection
          activeIds={state.facets.tags ?? []}
          onActiveIdsChange={(ids) => setFacets({ ...state.facets, tags: ids })}
          open={isSidebarSectionOpen('tags')}
          onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
        />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
