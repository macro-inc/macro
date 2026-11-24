import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { ConnectorImportSidebar } from '@app/features/connector-import/connector-import';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { FavoriteUnreadIndicator } from '@app/features/favorites/FavoriteUnreadIndicator';
import { useProjectSavedViews } from '@app/features/projects/context/project-saved-views-context';
import { ProjectSavedViewsList } from '@app/features/projects/views/project-saved-views';
import { SidebarRoutineSuggestions } from '@app/features/routine-suggestions/routine-suggestions';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { tasksTimeRoute } from '@app/routes/routes';
import {
  favoriteSplitContent,
  useFavoriteDisplayName,
} from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ClockIcon from '@icon/system/regular/clock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  BUILT_IN_TASK_TABS,
  PROJECT_TABS,
  type TaskTabItem,
} from '../constants';
import { isProjectTab, projectScopeForTab } from '../core/task-navigation';
import { TasksCreateAction } from '../tasks-create-action';
import { useTasksView } from '../tasks-view-context';
import { useTasksTimeView } from '../time-view';
import type { TasksTab } from '../types';
import { TaskSavedViewsList } from '../views/task-saved-views';
import { TAB_ICONS } from './task-view-icons';

function TasksNavigation(props: {
  items: readonly TaskTabItem[];
  label: string;
  onSelect(id: TasksTab): void;
}) {
  const { state } = useTasksView();
  const projectViews = useProjectSavedViews();
  const timeView = useTasksTimeView();
  const isActive = (id: TasksTab) =>
    !timeView() &&
    !state.savedViewActive &&
    state.tab === id &&
    (!isProjectTab(id) || !projectViews?.selectedId());

  return (
    <ViewSidebar.Nav aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <ViewSidebar.Item
            active={isActive(item.id)}
            onClick={() => props.onSelect(item.id)}
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
        <FavoriteUnreadIndicator favorite={props.favorite} />
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
        sectionId="favorites"
        sectionLabel="Favorites"
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">Favorites</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
        </CollapsibleSection.Header>
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

/** Time across projects: My week and Team, behind `enable-time-tracking`. */
function TimeSection(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const flag = useFeatureFlag(enableTimeTracking);
  const navigate = useNavigate();
  const timeView = useTasksTimeView();
  const views = [
    {
      id: 'week' as const,
      label: () => t('timeTracking.myWeek'),
      icon: ClockIcon,
    },
    {
      id: 'team' as const,
      label: () => t('timeTracking.team'),
      icon: UsersIcon,
    },
  ];
  return (
    <Show when={flag().enabled}>
      <CollapsibleSection.Root
        sectionId="time"
        sectionLabel={t('timeTracking.timeSection')}
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">
              {t('timeTracking.timeSection')}
            </span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label={t('timeTracking.timeSection')}>
            <For each={views}>
              {(view) => (
                <ViewSidebar.Item
                  active={timeView() === view.id}
                  onClick={() =>
                    fireAndForget(
                      navigate({
                        route: tasksTimeRoute,
                        params: { timeView: view.id },
                      }),
                      'tasks-time'
                    )
                  }
                >
                  <ViewSidebar.Icon>
                    <Dynamic component={view.icon} class="size-4" />
                  </ViewSidebar.Icon>
                  <span class="truncate">{view.label()}</span>
                </ViewSidebar.Item>
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
  const { state, setTab, isSidebarSectionOpen, setSidebarSectionOpen } =
    useTasksView();
  const projectViews = useProjectSavedViews();
  const timeView = useTasksTimeView();
  const selectTab = (id: TasksTab) => {
    if (isProjectTab(id) && projectViews)
      projectViews.selectScope(projectScopeForTab(id));
    else setTab(id);
  };

  return (
    <ViewSidebar.Root
      reorderId="tasks"
      aria-label="Tasks navigation"
      class="relative"
    >
      <SidebarCreateHeader
        title="Tasks"
        createAction={
          !isTouchDevice() ? (
            <TasksCreateAction presentation="sidebar" />
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
        <SidebarRoutineSuggestions surface="tasks" />
        <ViewSidebar.Section
          id="views"
          label={t('viewMenus.taskViews')}
          headerless
          class="flex min-w-0 flex-col gap-(--sidebar-row-gap)"
        >
          <TasksNavigation
            items={BUILT_IN_TASK_TABS}
            label={t('viewMenus.taskViews')}
            onSelect={selectTab}
          />
          <TaskSavedViewsList showSelection={!timeView()} />
        </ViewSidebar.Section>
        <CollapsibleSection.Root
          sectionId="projects"
          sectionLabel={t('viewMenus.projects')}
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
            <div class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
              <TasksNavigation
                items={PROJECT_TABS}
                label={t('viewMenus.projectViews')}
                onSelect={selectTab}
              />
              <ProjectSavedViewsList showSelection={!timeView()} />
            </div>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>

        <TimeSection
          open={isSidebarSectionOpen('time')}
          onOpenChange={(open) => setSidebarSectionOpen('time', open)}
        />

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
