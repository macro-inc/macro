import {
  CollapsibleSection,
  SearchBar,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { ConnectorImportSidebar } from '@app/features/connector-import/connector-import';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { t } from '@app/lib/i18n';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import NoteIcon from '@icon/system/regular/note-pencil.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import StackIcon from '@icon/system/regular/stack.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  BUILT_IN_TASK_TABS,
  PROJECT_TABS,
  TASK_TABS,
  type TaskTabItem,
} from '../constants';
import { isProjectTab } from '../core/task-navigation';
import { TasksCreateAction } from '../tasks-create-action';
import { useTasksView } from '../tasks-view-context';
import type { TasksTab } from '../types';
import { TaskSavedViewsList } from '../views/task-saved-views';

const TAB_ICONS: Record<TasksTab, typeof NoteIcon> = {
  'my-tasks': CheckSquareIcon,
  'team-tasks': ListChecksIcon,
  'created-by-me': NoteIcon,
  'my-projects': StackIcon,
  projects: StackIcon,
  'created-projects': NoteIcon,
};

function TasksNavigation(props: {
  items: readonly TaskTabItem[];
  label: string;
}) {
  const { state, setTab } = useTasksView();

  return (
    <ViewSidebar.Nav aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <ViewSidebar.Item
            active={!state.savedViewActive && state.tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <ViewSidebar.Icon>
              <Dynamic component={TAB_ICONS[item.id]} class="size-4" />
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
    if (openTask({ id: favorite.entityId, fallbackName }, { event })) return;

    const result = layout.openWithSplit(favoriteSplitContent(favorite), {
      referredFrom: 'sidebar',
      preferNewSplit: event.shiftKey,
    });
    if (result.status === 'reused' && result.owner !== result.sourceOwner) {
      toast.alert('Content already open');
    }
  };

  return (
    <Show when={favorites().length > 0}>
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
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

export function TasksSidebar() {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const {
    state,
    setState,
    projectsEnabled,
    setTab,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useTasksView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () =>
      TASK_TABS.filter((tab) => !isProjectTab(tab.id) || projectsEnabled()).map(
        (tab) => tab.id
      ),
    activeId: () => state.tab,
    setActiveId: (id) => setTab(id as TasksTab),
  });

  return (
    <ViewSidebar.Root aria-label="Tasks navigation" class="relative">
      <SidebarCreateHeader
        title="Tasks"
        searchLabel="Search tasks"
        search={() => (
          <SearchBar
            label="Search tasks"
            placeholder="Search tasks"
            value={state.search}
            onValueChange={(search) => setState('search', search)}
          />
        )}
        createAction={
          !isTouchDevice() ? (
            <TasksCreateAction
              presentation="sidebar"
              projectsEnabled={projectsEnabled()}
            />
          ) : undefined
        }
        label={isProjectTab(state.tab) ? t('viewMenus.newProject') : 'New task'}
        onCreate={() =>
          layout.popoverSplit({
            type: 'component',
            id: isProjectTab(state.tab) ? 'project-compose' : 'task-compose',
          })
        }
      />

      <ViewSidebar.Content>
        <TasksNavigation
          items={BUILT_IN_TASK_TABS}
          label={t('viewMenus.taskViews')}
        />
        <Show when={projectsEnabled()}>
          <CollapsibleSection.Root
            open={isSidebarSectionOpen('projects')}
            onOpenChange={(open) => setSidebarSectionOpen('projects', open)}
          >
            <CollapsibleSection.Header>
              <CollapsibleSection.Trigger class="flex-1">
                <span class="min-w-0 truncate">{t('viewMenus.projects')}</span>
                <CollapsibleSection.Indicator />
              </CollapsibleSection.Trigger>
              <CollapsibleSection.Action
                aria-label={t('viewMenus.newProject')}
                onClick={() =>
                  layout.popoverSplit({
                    type: 'component',
                    id: 'project-compose',
                  })
                }
              >
                <PlusIcon class="size-3.5" />
              </CollapsibleSection.Action>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content>
              <TasksNavigation
                items={PROJECT_TABS}
                label={t('viewMenus.projectViews')}
              />
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>
        <TaskSavedViewsList />

        <TaskFavorites
          open={isSidebarSectionOpen('favorites')}
          onOpenChange={(open) => setSidebarSectionOpen('favorites', open)}
        />
      </ViewSidebar.Content>
      {/* Keep import controls anchored below the navigation sections. */}
      <ConnectorImportSidebar
        category="tasks"
        class="absolute inset-x-(--sidebar-gutter) bottom-(--sidebar-content-inset) z-10"
      />
    </ViewSidebar.Root>
  );
}
