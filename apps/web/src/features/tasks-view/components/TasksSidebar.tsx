import {
  CollapsibleSection,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import CheckSquareIcon from '@phosphor/check-square.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import PlusIcon from '@phosphor/plus.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button } from '@ui';
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
            class="font-normal"
            onClick={() => {
              setTab(item.id);
              props.onNavigate?.();
            }}
          >
            <Dynamic
              component={item.icon}
              aria-hidden="true"
              class="size-4 shrink-0"
            />
            <span class="truncate">{item.label}</span>
          </ViewSidebar.Item>
        )}
      </For>
    </ViewSidebar.Nav>
  );
}

function FavoriteRow(props: {
  favorite: Favorite;
  onOpen: (favorite: Favorite) => void;
}) {
  const name = useFavoriteDisplayName(props.favorite);

  return (
    <ViewSidebar.Item
      class="font-normal"
      title={name()}
      onClick={() => props.onOpen(props.favorite)}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </span>
      <span class="truncate">{name()}</span>
    </ViewSidebar.Item>
  );
}

function TaskFavorites(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useFavoritesData();
  const layout = useSplitLayout();
  const favorites = createMemo(() =>
    (data()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'document' &&
          favorite.documentSubType === 'task'
      )
      .sort((left, right) => left.sortOrder - right.sortOrder)
  );

  const openFavorite = (favorite: Favorite) => {
    layout.openWithSplit(favoriteSplitContent(favorite), {
      referredFrom: 'sidebar',
    });
  };

  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Trigger class="text-xs">
        <CollapsibleSection.Indicator class="order-first ml-0" />
        <span class="truncate">Favorites</span>
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
    <ViewSidebar.Root aria-label="Tasks navigation" class="gap-4 bg-panel">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Tasks</ViewSidebar.Title>
        </div>
        <SplitPanel.ControlGroup>
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </ViewSidebar.Header>

      <ViewSidebar.Content class="flex flex-col gap-6">
        <div class="flex shrink-0 flex-col gap-6">
          <Button
            type="button"
            variant="ghost"
            depth={2}
            class="h-10 shrink-0 justify-start gap-3 rounded-xl bg-surface px-3"
            onClick={() =>
              layout.popoverSplit({ type: 'component', id: 'task-compose' })
            }
          >
            <PlusIcon class="size-4 shrink-0" />
            New task
          </Button>

          <TasksNavigation />
        </div>

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
